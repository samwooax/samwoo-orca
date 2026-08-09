from concurrent.futures import ThreadPoolExecutor
import json
import os
import queue
import sqlite3
import tempfile
import threading
import unittest
from unittest import mock

import profile_messaging
import profile_event_stream
import profile_display_names
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

    def test_message_serialization_adds_registered_names_without_changing_logins(self):
        with mock.patch.object(
            profile_display_names,
            "display_name",
            side_effect=lambda login: {"owner": "홍길동"}.get(login),
        ):
            original = profile_messaging.send_message(
                OWNER_TOKEN, {"channelKind": "team", "body": "원문"}
            )
            reply = profile_messaging.send_message(
                PEER_TOKEN,
                {"channelKind": "team", "body": "답장", "replyToId": original["id"]},
            )
            channel = profile_messaging.list_channels(OWNER_TOKEN)[0]

        self.assertEqual(
            ("owner", "홍길동"),
            (original["authorLogin"], original["authorDisplayName"]),
        )
        self.assertIsNone(reply["authorDisplayName"])
        self.assertEqual("홍길동", reply["replyToAuthorDisplayName"])
        self.assertEqual("peer", channel["lastMessageAuthor"])
        self.assertIsNone(channel["lastMessageAuthorDisplayName"])

    def test_member_route_derives_profile_from_session(self):
        with mock.patch.object(
            profile_display_names,
            "profile_members",
            return_value=[{"login": "owner", "name": "홍길동"}],
        ) as members:
            status, payload = workspace_share_endpoints.handle_workspace_share(
                "/profile-members/list", f"Bearer {OWNER_TOKEN}", {"profile": "sales"}
            )

        self.assertEqual(200, status)
        self.assertEqual([{"login": "owner", "name": "홍길동"}], payload["members"])
        members.assert_called_once_with("ai_center")

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

    def test_client_message_id_is_idempotent_under_concurrent_retries(self):
        body = {
            "channelKind": "team",
            "body": "한 번만 저장",
            "clientMessageId": "client-message-0001",
        }
        barrier = threading.Barrier(2)

        def send():
            barrier.wait()
            return profile_messaging.send_message(OWNER_TOKEN, body)

        with ThreadPoolExecutor(max_workers=2) as executor:
            messages = list(executor.map(lambda _index: send(), range(2)))
        self.assertEqual(messages[0]["id"], messages[1]["id"])
        self.assertNotIn("clientMessageId", messages[0])
        with workspace_sharing._database() as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM profile_messages WHERE client_message_id=?",
                (body["clientMessageId"],),
            ).fetchone()[0]
        self.assertEqual(1, count)

    def test_message_and_read_events_publish_after_success(self):
        subscription = profile_event_stream.subscribe("ai_center", "observer")
        self.addCleanup(subscription.close)
        while True:
            try:
                subscription.get_nowait()
            except queue.Empty:
                break
        sent = profile_messaging.send_message(
            OWNER_TOKEN,
            {
                "channelKind": "team",
                "body": "이벤트 확인",
                "clientMessageId": "client-message-event-1",
            },
        )
        message_event = subscription.get(timeout=1)
        self.assertEqual(("message", sent["id"]), (
            message_event["type"], message_event["message"]["id"]
        ))
        profile_messaging.mark_read(
            PEER_TOKEN, {"channelKind": "team", "messageId": sent["id"]}
        )
        read_event = subscription.get(timeout=1)
        self.assertEqual(
            {"type": "read", "channelKey": "team", "login": "peer"}, read_event
        )

    def test_concurrent_mark_read_keeps_latest_cursor(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
                VALUES (?,?,?,?,?,?,?)""",
                [
                    ("read-first", "ai_center", "team", "team", "owner", "first", 1),
                    ("read-second", "ai_center", "team", "team", "owner", "second", 2),
                ],
            )
        barrier = threading.Barrier(8)

        def mark(index):
            barrier.wait()
            message_id = "read-second" if index % 2 else "read-first"
            profile_messaging.mark_read(
                PEER_TOKEN, {"channelKind": "team", "messageId": message_id}
            )

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(mark, range(8)))
        with workspace_sharing._database() as conn:
            cursor = conn.execute(
                """SELECT last_read_created_at,last_read_id FROM profile_message_reads
                WHERE owner_profile='ai_center' AND login='peer' AND channel_key='team'"""
            ).fetchone()
        self.assertEqual((2, "read-second"), tuple(cursor))

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

    def test_search_is_profile_and_workspace_scoped(self):
        share = self.create_share()
        profile_messaging.send_message(
            OWNER_TOKEN, {"channelKind": "team", "body": "분기별 매출 검토"}
        )
        profile_messaging.send_message(
            OTHER_TOKEN, {"channelKind": "team", "body": "분기별 매출 외부 프로필"}
        )
        result = profile_messaging.search_messages(
            PEER_TOKEN, {"channelKind": "team", "query": "분기별 매출"}
        )
        self.assertEqual(["분기별 매출 검토"], [row["body"] for row in result["messages"]])
        with self.assertRaises(profile_messaging.ProfileMessagingError):
            profile_messaging.search_messages(
                OTHER_TOKEN,
                {"channelKind": "workspace", "shareId": share["id"], "query": "매출"},
            )

    def test_search_escapes_like_wildcards(self):
        for body in (
            "진행률 100%", "진행률 1000", "코드 a_b", "코드 axb", "경로 A\\B", "경로 AB",
        ):
            profile_messaging.send_message(
                OWNER_TOKEN, {"channelKind": "team", "body": body}
            )
        percent = profile_messaging.search_messages(
            PEER_TOKEN, {"channelKind": "team", "query": "100%"}
        )
        underscore = profile_messaging.search_messages(
            PEER_TOKEN, {"channelKind": "team", "query": "a_b"}
        )
        backslash = profile_messaging.search_messages(
            PEER_TOKEN, {"channelKind": "team", "query": "A\\B"}
        )
        self.assertEqual(["진행률 100%"], [row["body"] for row in percent["messages"]])
        self.assertEqual(["코드 a_b"], [row["body"] for row in underscore["messages"]])
        self.assertEqual(["경로 A\\B"], [row["body"] for row in backslash["messages"]])

    def test_search_route_validates_query(self):
        self.assertTrue(
            workspace_share_endpoints.is_workspace_share_path("/profile-messages/search")
        )
        for query in ("한", "x" * 65, "검색\n문자"):
            status, payload = workspace_share_endpoints.handle_workspace_share(
                "/profile-messages/search",
                f"Bearer {PEER_TOKEN}",
                {"channelKind": "team", "query": query},
            )
            self.assertEqual(400, status)
            self.assertFalse(payload["ok"])
        status, payload = workspace_share_endpoints.handle_workspace_share(
            "/profile-messages/search",
            f"Bearer {PEER_TOKEN}",
            {"channelKind": "team", "query": "검색어"},
        )
        self.assertEqual(200, status)
        self.assertTrue(payload["ok"])

    def test_search_cursor_is_complete_and_bounded(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
                VALUES (?,?,?,?,?,?,?)""",
                [
                    (f"search-{index:03}", "ai_center", "team", "team", "owner", "검색 대상", 10)
                    for index in range(profile_messaging.SEARCH_PAGE_SIZE + 1)
                ],
            )
        first = profile_messaging.search_messages(
            PEER_TOKEN, {"channelKind": "team", "query": "검색 대상"}
        )
        self.assertEqual(profile_messaging.SEARCH_PAGE_SIZE, len(first["messages"]))
        self.assertTrue(first["hasMore"])
        second = profile_messaging.search_messages(
            PEER_TOKEN,
            {
                "channelKind": "team",
                "query": "검색 대상",
                "beforeCreatedAt": first["messages"][0]["createdAt"],
                "beforeId": first["messages"][0]["id"],
            },
        )
        ids = [row["id"] for row in second["messages"] + first["messages"]]
        self.assertEqual([f"search-{index:03}" for index in range(51)], ids)
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

    def test_client_message_id_migration_preserves_existing_rows(self):
        legacy_id = "legacy-message"
        connection = sqlite3.connect(workspace_sharing.DB_PATH)
        connection.execute(
            """CREATE TABLE profile_messages (
            id TEXT PRIMARY KEY, owner_profile TEXT NOT NULL, channel_key TEXT NOT NULL,
            channel_kind TEXT NOT NULL, share_id TEXT, author_login TEXT NOT NULL,
            body TEXT NOT NULL, reply_to_id TEXT, created_at INTEGER NOT NULL
            )"""
        )
        connection.execute(
            """INSERT INTO profile_messages
            (id,owner_profile,channel_key,channel_kind,author_login,body,created_at)
            VALUES (?,?,?,?,?,?,?)""",
            (legacy_id, "ai_center", "team", "team", "owner", "보존", 1),
        )
        connection.commit()
        connection.close()

        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            row = conn.execute(
                "SELECT body,client_message_id FROM profile_messages WHERE id=?", (legacy_id,)
            ).fetchone()
            index = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='profile_messages_client_id_idx'"
            ).fetchone()
        self.assertEqual(("보존", None), tuple(row))
        self.assertIsNotNone(index)


if __name__ == "__main__":
    unittest.main()
