import json
import os
import tempfile
import unittest
from unittest import mock

import workspace_share_endpoints
import workspace_sharing


OWNER_TOKEN = "token-owner-0123456789"
PEER_TOKEN = "token-peer-01234567890"
OTHER_TOKEN = "token-other-0123456789"


class WorkspaceCommentTest(unittest.TestCase):
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

    def create_share(self, name="프로젝트 보드"):
        return workspace_sharing.create_share(
            OWNER_TOKEN,
            {
                "displayName": name,
                "sourceKind": "nextcloud",
                "permission": "download",
            },
        )

    def create_comment(self, share, body="검토"):
        return workspace_sharing.create_comment(
            PEER_TOKEN, {"shareId": share["id"], "body": body}
        )

    def test_comment_pages_are_bounded_and_stable(self):
        share = self.create_share()
        with workspace_sharing._connect() as conn:
            conn.executemany(
                """INSERT INTO workspace_share_comments
                (id,share_id,author_login,body,created_at,updated_at)
                VALUES (?,?,?,?,?,?)""",
                [
                    (
                        f"comment-{index:03}",
                        share["id"],
                        "peer",
                        f"{index:03}" + ("x" * 1997),
                        index,
                        index,
                    )
                    for index in range(workspace_sharing.COMMENT_PAGE_SIZE + 5)
                ],
            )
        first = workspace_sharing.list_comments(PEER_TOKEN, {"shareId": share["id"]})
        self.assertEqual(workspace_sharing.COMMENT_PAGE_SIZE, len(first["comments"]))
        self.assertEqual(workspace_sharing.COMMENT_PAGE_SIZE + 5, first["commentCount"])
        self.assertTrue(first["hasMoreComments"])
        self.assertEqual("comment-005", first["comments"][0]["id"])
        self.assertLess(len(json.dumps(first).encode("utf-8")), 512 * 1024)

        second = workspace_sharing.list_comments(
            PEER_TOKEN,
            {
                "shareId": share["id"],
                "beforeCreatedAt": first["nextBeforeCreatedAt"],
                "beforeId": first["nextBeforeId"],
            },
        )
        self.assertEqual([f"comment-{index:03}" for index in range(5)], [item["id"] for item in second["comments"]])
        self.assertFalse(second["hasMoreComments"])

    def test_repeated_completion_preserves_original_actor(self):
        share = self.create_share()
        comment = self.create_comment(share)
        first = workspace_sharing.set_comment_completed(
            PEER_TOKEN,
            {"shareId": share["id"], "commentId": comment["id"], "completed": True},
        )
        repeated = workspace_sharing.set_comment_completed(
            OWNER_TOKEN,
            {"shareId": share["id"], "commentId": comment["id"], "completed": True},
        )
        self.assertEqual("peer", repeated["completedBy"])
        self.assertEqual(first["completedAt"], repeated["completedAt"])

    def test_cross_profile_and_cross_share_completion_are_blocked(self):
        first_share = self.create_share("first")
        second_share = self.create_share("second")
        comment = self.create_comment(first_share)
        for token, share_id in (
            (OTHER_TOKEN, first_share["id"]),
            (OWNER_TOKEN, second_share["id"]),
        ):
            with self.subTest(token=token, share_id=share_id), self.assertRaises(
                workspace_sharing.WorkspaceShareError
            ):
                workspace_sharing.set_comment_completed(
                    token,
                    {"shareId": share_id, "commentId": comment["id"], "completed": True},
                )

    def test_revoked_share_blocks_every_comment_operation(self):
        share = self.create_share()
        comment = self.create_comment(share)
        workspace_sharing.revoke_share(OWNER_TOKEN, {"id": share["id"]})
        operations = (
            lambda: workspace_sharing.list_comments(PEER_TOKEN, {"shareId": share["id"]}),
            lambda: workspace_sharing.create_comment(
                PEER_TOKEN, {"shareId": share["id"], "body": "차단"}
            ),
            lambda: workspace_sharing.set_comment_completed(
                PEER_TOKEN,
                {"shareId": share["id"], "commentId": comment["id"], "completed": True},
            ),
        )
        for operation in operations:
            with self.assertRaises(workspace_sharing.WorkspaceShareError):
                operation()

    def test_invalid_comment_inputs_are_rejected(self):
        share = self.create_share()
        comment = self.create_comment(share)
        invalid_bodies = ("x" * 2001, "control\0character")
        for body in invalid_bodies:
            with self.subTest(body=body[:20]), self.assertRaises(
                workspace_sharing.WorkspaceShareError
            ):
                workspace_sharing.create_comment(
                    PEER_TOKEN, {"shareId": share["id"], "body": body}
                )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.set_comment_completed(
                PEER_TOKEN,
                {"shareId": share["id"], "commentId": comment["id"], "completed": "true"},
            )
        for cursor in (
            {"beforeCreatedAt": -1, "beforeId": comment["id"]},
            {"beforeCreatedAt": comment["createdAt"]},
            {"beforeCreatedAt": True, "beforeId": comment["id"]},
        ):
            with self.subTest(cursor=cursor), self.assertRaises(
                workspace_sharing.WorkspaceShareError
            ):
                workspace_sharing.list_comments(
                    PEER_TOKEN, {"shareId": share["id"], **cursor}
                )

    def test_missing_or_expired_bearer_is_unauthorized(self):
        share = self.create_share()
        status, _ = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/comments/list", None, {"shareId": share["id"]}
        )
        self.assertEqual(401, status)
        workspace_sharing.revoke_session(PEER_TOKEN)
        status, _ = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/comments/list",
            f"Bearer {PEER_TOKEN}",
            {"shareId": share["id"]},
        )
        self.assertEqual(401, status)


if __name__ == "__main__":
    unittest.main()
