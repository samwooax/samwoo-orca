import os
import tempfile
import unittest

import workspace_sharing
import workspace_share_endpoints


class WorkspaceSharingTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        workspace_sharing._sessions.clear()
        workspace_sharing.bind_session("token-owner-0123456789", "owner", "ai_center")
        workspace_sharing.bind_session("token-peer-01234567890", "peer", "ai_center")
        workspace_sharing.bind_session("token-other-0123456789", "other", "sales")

    def tearDown(self):
        self.tempdir.cleanup()

    def create(self):
        return workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "프로젝트 보드",
                "repositoryUrl": "https://github.com/samwoo/project.git",
                "permission": "clone",
            },
        )

    def test_lists_only_same_profile(self):
        share = self.create()
        self.assertEqual([share["id"]], [item["id"] for item in workspace_sharing.list_shares("token-peer-01234567890")])
        self.assertEqual([], workspace_sharing.list_shares("token-other-0123456789"))

    def test_only_owner_can_edit_and_revoke(self):
        share = self.create()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.update_share(
                "token-peer-01234567890",
                {"id": share["id"], "displayName": "탈취", "permission": "clone"},
            )
        workspace_sharing.update_share(
            "token-owner-0123456789",
            {"id": share["id"], "displayName": "수정 이름", "permission": "contribute"},
        )
        workspace_sharing.revoke_share("token-owner-0123456789", {"id": share["id"]})
        self.assertEqual([], workspace_sharing.list_shares("token-peer-01234567890"))

    def test_rejects_local_or_credentialed_remote(self):
        for remote in (
            "file:///tmp/project", "file:C:\\project", "/tmp/project", "C:\\project",
            "https://token@example.com/p.git", "https://user:secret@example.com/p.git",
        ):
            with self.subTest(remote=remote), self.assertRaises(workspace_sharing.WorkspaceShareError):
                workspace_sharing.create_share(
                    "token-owner-0123456789",
                    {"displayName": "bad", "repositoryUrl": remote, "permission": "clone"},
                )

    def test_profile_members_comment_and_track_completion(self):
        share = self.create()
        comment = workspace_sharing.create_comment(
            "token-peer-01234567890",
            {"shareId": share["id"], "body": "설계 검토\n완료 조건 확인"},
        )
        completed = workspace_sharing.set_comment_completed(
            "token-owner-0123456789",
            {"shareId": share["id"], "commentId": comment["id"], "completed": True},
        )
        self.assertTrue(completed["completed"])
        self.assertEqual("owner", completed["completedBy"])
        listed = workspace_sharing.list_comments("token-peer-01234567890", {"shareId": share["id"]})
        self.assertEqual([comment["id"]], [item["id"] for item in listed["comments"]])
        self.assertEqual(1, workspace_sharing.list_shares("token-owner-0123456789")[0]["commentCount"])

    def test_comments_are_profile_scoped_and_hidden_after_revoke(self):
        share = self.create()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.create_comment(
                "token-other-0123456789", {"shareId": share["id"], "body": "침입"}
            )
        workspace_sharing.revoke_share("token-owner-0123456789", {"id": share["id"]})
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.list_comments(
                "token-peer-01234567890", {"shareId": share["id"]}
            )

    def test_comment_http_routes(self):
        share = self.create()
        status, created = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/comments/create",
            "Bearer token-peer-01234567890",
            {"shareId": share["id"], "body": "배포 확인"},
        )
        self.assertEqual(200, status)
        status, completed = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/comments/complete",
            "Bearer token-owner-0123456789",
            {"shareId": share["id"], "commentId": created["comment"]["id"], "completed": True},
        )
        self.assertEqual(200, status)
        self.assertTrue(completed["comment"]["completed"])
        status, listed = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/comments/list",
            "Bearer token-peer-01234567890",
            {"shareId": share["id"]},
        )
        self.assertEqual(1, len(listed["comments"]))
        self.assertEqual(1, listed["commentCount"])
        self.assertEqual(200, status)


if __name__ == "__main__":
    unittest.main()
