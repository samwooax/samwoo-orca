import os
import tempfile
import unittest
from unittest import mock

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

    @mock.patch("workspace_sharing.nextcloud_workspace_storage.ensure_workspace")
    def test_nextcloud_share_is_profile_scoped(self, ensure_workspace):
        ensure_workspace.return_value = "SAMWOO-Workspaces/ai_center/share-id"
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "팀 자료",
                "sourceKind": "nextcloud",
                "permission": "clone",
            },
        )
        self.assertEqual("nextcloud", share["sourceKind"])
        self.assertEqual("", share["repositoryUrl"])
        self.assertNotIn("storagePath", share)
        self.assertEqual([], workspace_sharing.list_shares("token-other-0123456789"))
        ensure_workspace.assert_called_once_with("ai_center", share["id"])

    @mock.patch("workspace_sharing.nextcloud_workspace_storage.list_directory")
    @mock.patch("workspace_sharing.nextcloud_workspace_storage.read_file")
    @mock.patch("workspace_sharing.nextcloud_workspace_storage.ensure_workspace")
    def test_nextcloud_download_respects_profile_and_view_permission(
        self, ensure_workspace, read_file, list_directory
    ):
        ensure_workspace.return_value = "SAMWOO-Workspaces/ai_center/share-id"
        read_file.return_value = {"path": "note.txt", "contentBase64": "b2s=", "etag": "1", "size": 2}
        list_directory.return_value = [{"name": "note.txt", "kind": "file", "size": 2}]
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "clone"},
        )
        workspace_sharing.list_workspace_files(
            "token-peer-01234567890", {"shareId": share["id"]}
        )
        workspace_sharing.read_workspace_file(
            "token-peer-01234567890", {"shareId": share["id"], "path": "note.txt"}
        )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.read_workspace_file(
                "token-other-0123456789", {"shareId": share["id"], "path": "note.txt"}
            )
        workspace_sharing.update_share(
            "token-owner-0123456789",
            {"id": share["id"], "displayName": "팀 자료", "permission": "view"},
        )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.list_workspace_files(
                "token-peer-01234567890", {"shareId": share["id"]}
            )
        workspace_sharing.list_workspace_files(
            "token-owner-0123456789", {"shareId": share["id"]}
        )
        workspace_sharing.read_workspace_file(
            "token-owner-0123456789", {"shareId": share["id"], "path": "note.txt"}
        )

    def test_rejects_invalid_share_identity_before_storage_access(self):
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.list_workspace_files(
                "token-peer-01234567890", {"shareId": "../../auth-server.py"}
            )

    @mock.patch("workspace_sharing.nextcloud_workspace_storage.write_file")
    @mock.patch("workspace_sharing.nextcloud_workspace_storage.ensure_workspace")
    def test_nextcloud_write_requires_owner_or_contribute(self, ensure_workspace, write_file):
        ensure_workspace.return_value = "SAMWOO-Workspaces/ai_center/share-id"
        write_file.return_value = {"path": "note.txt", "etag": "new", "size": 2}
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "팀 자료",
                "sourceKind": "nextcloud",
                "permission": "clone",
            },
        )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.write_workspace_file(
                "token-peer-01234567890",
                {"shareId": share["id"], "path": "note.txt", "contentBase64": "b2s="},
            )
        workspace_sharing.write_workspace_file(
            "token-owner-0123456789",
            {"shareId": share["id"], "path": "note.txt", "contentBase64": "b2s="},
        )
        workspace_sharing.update_share(
            "token-owner-0123456789",
            {"id": share["id"], "displayName": "팀 자료", "permission": "contribute"},
        )
        workspace_sharing.write_workspace_file(
            "token-peer-01234567890",
            {"shareId": share["id"], "path": "note.txt", "contentBase64": "b2s="},
        )
        self.assertEqual(2, write_file.call_count)

    @mock.patch("workspace_sharing.nextcloud_workspace_storage.write_file")
    @mock.patch("workspace_sharing.nextcloud_workspace_storage.ensure_workspace")
    def test_file_conflict_has_a_distinct_http_response(self, ensure_workspace, write_file):
        ensure_workspace.return_value = "SAMWOO-Workspaces/ai_center/share-id"
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "clone"},
        )
        write_file.side_effect = (
            workspace_sharing.nextcloud_workspace_storage.NextcloudStorageConflictError(
                "changed"
            )
        )

        status, result = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/files/write",
            "Bearer token-owner-0123456789",
            {
                "shareId": share["id"],
                "path": "note.txt",
                "contentBase64": "b2s=",
                "createOnly": True,
            },
        )

        self.assertEqual(409, status)
        self.assertEqual("file_conflict", result["errorCode"])

    @mock.patch("workspace_sharing.nextcloud_workspace_storage.delete_file")
    @mock.patch("workspace_sharing.nextcloud_workspace_storage.ensure_workspace")
    def test_nextcloud_delete_requires_owner_or_contribute(self, ensure_workspace, delete_file):
        ensure_workspace.return_value = "SAMWOO-Workspaces/ai_center/share-id"
        delete_file.return_value = {"path": "old.txt"}
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "clone"},
        )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.delete_workspace_file(
                "token-peer-01234567890",
                {"shareId": share["id"], "path": "old.txt", "expectedEtag": "old"},
            )

        workspace_sharing.delete_workspace_file(
            "token-owner-0123456789",
            {"shareId": share["id"], "path": "old.txt", "expectedEtag": "old"},
        )

        delete_file.assert_called_once_with("ai_center", share["id"], "old.txt", "old")


if __name__ == "__main__":
    unittest.main()
