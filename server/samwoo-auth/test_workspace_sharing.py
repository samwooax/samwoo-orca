import os
import tempfile
import unittest

import workspace_sharing


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


if __name__ == "__main__":
    unittest.main()
