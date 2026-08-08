import json
import os
import tempfile
import unittest
from unittest import mock

import profile_messaging
import workspace_share_endpoints
import workspace_sharing


OWNER_TOKEN = "message-owner-token-0123456789"
PEER_TOKEN = "message-peer-token-01234567890"
OTHER_TOKEN = "message-other-token-0123456789"


class ProfileMessagingTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        workspace_sharing._sessions.clear()
        workspace_sharing.bind_session(OWNER_TOKEN, "owner", "ai_center")
        workspace_sharing.bind_session(PEER_TOKEN, "peer", "ai_center")
        workspace_sharing.bind_session(OTHER_TOKEN, "other", "sales")
        self.ensure_workspace = mock.patch(
            "workspace_sharing.nextcloud_workspace_storage.ensure_workspace",
            return_value="SAMWOO-Workspaces/profile/share-id",
        ).start()

    def tearDown(self):
        mock.patch.stopall()
        self.tempdir.cleanup()

    def create_share(self):
        return workspace_sharing.create_share(
            OWNER_TOKEN,
            {"displayName": "중앙 프로젝트", "sourceKind": "nextcloud", "permission": "contribute"},
        )

    def test_team_messages_are_profile_scoped_and_track_unread_per_user(self):
        sent = profile_messaging.send_message(
            OWNER_TOKEN, {"channelKind": "team", "body": "검토 부탁드립니다"}
        )
        peer_channels = profile_messaging.list_channels(PEER_TOKEN)
        self.assertEqual(1, peer_channels[0]["unreadCount"])
        self.assertEqual("검토 부탁드립니다", peer_channels[0]["lastMessagePreview"])
        self.assertEqual([], profile_messaging.list_messages(OTHER_TOKEN, {"channelKind": "team"})["messages"])

        profile_messaging.mark_read(
            PEER_TOKEN,
            {"channelKind": "team", "messageId": sent["id"]},
        )
        self.assertEqual(0, profile_messaging.list_channels(PEER_TOKEN)[0]["unreadCount"])

    def test_channel_catalog_aggregates_latest_messages_and_unread_counts(self):
        share = self.create_share()
        profile_messaging.send_message(
            OWNER_TOKEN, {"channelKind": "team", "body": "팀 최신 메시지"}
        )
        profile_messaging.send_message(
            OWNER_TOKEN,
            {
                "channelKind": "workspace",
                "shareId": share["id"],
                "body": "워크스페이스 최신 메시지",
            },
        )

        channels = {
            channel["key"]: channel
            for channel in profile_messaging.list_channels(PEER_TOKEN)
        }
        self.assertEqual(1, channels["team"]["unreadCount"])
        self.assertEqual("팀 최신 메시지", channels["team"]["lastMessagePreview"])
        workspace = channels[f"workspace:{share['id']}"]
        self.assertEqual(1, workspace["unreadCount"])
        self.assertEqual("워크스페이스 최신 메시지", workspace["lastMessagePreview"])

    def test_workspace_channel_requires_active_share_in_same_profile(self):
        share = self.create_share()
        message = profile_messaging.send_message(
            PEER_TOKEN,
            {"channelKind": "workspace", "shareId": share["id"], "body": "파일 확인했습니다"},
        )
        listed = profile_messaging.list_messages(
            OWNER_TOKEN, {"channelKind": "workspace", "shareId": share["id"]}
        )
        self.assertEqual(message["id"], listed["messages"][0]["id"])
        with self.assertRaises(profile_messaging.ProfileMessagingError):
            profile_messaging.list_messages(
                OTHER_TOKEN, {"channelKind": "workspace", "shareId": share["id"]}
            )
        workspace_sharing.revoke_share(OWNER_TOKEN, {"id": share["id"]})
        with self.assertRaises(profile_messaging.ProfileMessagingError):
            profile_messaging.send_message(
                PEER_TOKEN,
                {"channelKind": "workspace", "shareId": share["id"], "body": "차단"},
            )

    def test_replies_cannot_cross_channels(self):
        share = self.create_share()
        team = profile_messaging.send_message(
            OWNER_TOKEN, {"channelKind": "team", "body": "팀 메시지"}
        )
        with self.assertRaises(profile_messaging.ProfileMessagingError):
            profile_messaging.send_message(
                PEER_TOKEN,
                {
                    "channelKind": "workspace",
                    "shareId": share["id"],
                    "body": "잘못된 답글",
                    "replyToId": team["id"],
                },
            )
        reply = profile_messaging.send_message(
            PEER_TOKEN,
            {"channelKind": "team", "body": "확인했습니다", "replyToId": team["id"]},
        )
        self.assertEqual("owner", reply["replyToAuthor"])
        self.assertEqual("팀 메시지", reply["replyToPreview"])

    def test_routes_validate_sessions_and_message_size(self):
        status, payload = workspace_share_endpoints.handle_workspace_share(
            "/profile-messages/send",
            f"Bearer {OWNER_TOKEN}",
            {"channelKind": "team", "body": "x" * 4001},
        )
        self.assertEqual(400, status)
        self.assertFalse(payload["ok"])
        status, _ = workspace_share_endpoints.handle_workspace_share(
            "/profile-messages/channels/list", None, {}
        )
        self.assertEqual(401, status)

    def test_same_timestamp_pagination_is_complete_and_bounded(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
                VALUES (?,?,?,?,?,?,?)""",
                [
                    (f"message-{index:03}", "ai_center", "team", "team", "owner", "x", 10)
                    for index in range(profile_messaging.MESSAGE_PAGE_SIZE + 1)
                ],
            )
        first = profile_messaging.list_messages(PEER_TOKEN, {"channelKind": "team"})
        self.assertEqual(profile_messaging.MESSAGE_PAGE_SIZE, len(first["messages"]))
        self.assertTrue(first["hasMore"])
        second = profile_messaging.list_messages(
            PEER_TOKEN,
            {
                "channelKind": "team",
                "beforeCreatedAt": first["messages"][0]["createdAt"],
                "beforeId": first["messages"][0]["id"],
            },
        )
        ids = [item["id"] for item in second["messages"] + first["messages"]]
        self.assertEqual([f"message-{index:03}" for index in range(101)], ids)
        self.assertEqual(len(ids), len(set(ids)))

    def test_read_cursor_cannot_move_backward(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
                VALUES (?,?,?,?,?,?,?)""",
                [
                    ("first", "ai_center", "team", "team", "owner", "first", 1),
                    ("second", "ai_center", "team", "team", "owner", "second", 2),
                ],
            )
        profile_messaging.mark_read(
            PEER_TOKEN, {"channelKind": "team", "messageId": "second"}
        )
        profile_messaging.mark_read(
            PEER_TOKEN, {"channelKind": "team", "messageId": "first"}
        )
        self.assertEqual(0, profile_messaging.list_channels(PEER_TOKEN)[0]["unreadCount"])

    def test_revoked_workspace_channel_is_removed_from_catalog(self):
        share = self.create_share()
        keys = [channel["key"] for channel in profile_messaging.list_channels(PEER_TOKEN)]
        self.assertIn(f"workspace:{share['id']}", keys)
        workspace_sharing.revoke_share(OWNER_TOKEN, {"id": share["id"]})
        keys = [channel["key"] for channel in profile_messaging.list_channels(PEER_TOKEN)]
        self.assertNotIn(f"workspace:{share['id']}", keys)

    def test_maximal_unicode_page_fits_client_response_budget(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
                VALUES (?,?,?,?,?,?,?)""",
                [
                    (f"unicode-{index:03}", "ai_center", "team", "team", "owner", "😀" * 4000, index)
                    for index in range(profile_messaging.MESSAGE_PAGE_SIZE)
                ],
            )
        page = profile_messaging.list_messages(PEER_TOKEN, {"channelKind": "team"})
        self.assertLess(len(json.dumps(page).encode("utf-8")), 8 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
