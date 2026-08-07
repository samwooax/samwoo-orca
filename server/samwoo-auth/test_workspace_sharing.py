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
        self.ensure_workspace = mock.patch(
            "workspace_sharing.nextcloud_workspace_storage.ensure_workspace",
            return_value="SAMWOO-Workspaces/profile/share-id",
        ).start()

    def tearDown(self):
        mock.patch.stopall()
        self.tempdir.cleanup()

    def create(self):
        return workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "프로젝트 보드",
                "sourceKind": "nextcloud",
                "permission": "download",
            },
        )

    def test_lists_only_same_profile(self):
        share = self.create()
        self.assertEqual([share["id"]], [item["id"] for item in workspace_sharing.list_shares("token-peer-01234567890")])
        self.assertEqual([], workspace_sharing.list_shares("token-other-0123456789"))

    def test_session_survives_memory_reset_without_storing_raw_token(self):
        share = self.create()
        workspace_sharing._sessions.clear()

        self.assertEqual(
            [share["id"]],
            [
                item["id"]
                for item in workspace_sharing.list_shares("token-peer-01234567890")
            ],
        )
        with workspace_sharing._database() as conn:
            stored = conn.execute(
                "SELECT token_hash FROM workspace_sessions WHERE login='peer'"
            ).fetchone()["token_hash"]
        self.assertNotEqual("token-peer-01234567890", stored)
        self.assertEqual(64, len(stored))

    @mock.patch("workspace_share_endpoints.mail_ext.revoke_session")
    def test_session_revoke_route_removes_persisted_session(self, revoke_mail_session):
        status, result = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/session/revoke",
            "Bearer token-peer-01234567890",
            {},
        )
        self.assertEqual(200, status)
        self.assertTrue(result["ok"])
        revoke_mail_session.assert_called_once_with("token-peer-01234567890")
        workspace_sharing._sessions.clear()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.list_shares("token-peer-01234567890")

    def test_invalid_share_does_not_create_nextcloud_directory(self):
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.create_share(
                "token-owner-0123456789",
                {
                    "displayName": "",
                    "sourceKind": "nextcloud",
                    "permission": "download",
                },
            )
        self.ensure_workspace.assert_not_called()

    def test_only_owner_can_edit_and_revoke(self):
        share = self.create()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.update_share(
                "token-peer-01234567890",
                {"id": share["id"], "displayName": "탈취", "permission": "download"},
            )
        workspace_sharing.update_share(
            "token-owner-0123456789",
            {"id": share["id"], "displayName": "수정 이름", "permission": "contribute"},
        )
        workspace_sharing.revoke_share("token-owner-0123456789", {"id": share["id"]})
        self.assertEqual([], workspace_sharing.list_shares("token-peer-01234567890"))

    def test_board_status_is_shared_with_audit_without_file_change_notification(self):
        share = self.create()
        self.assertEqual("todo", share["boardStatus"])
        file_revision = share["updatedAt"]

        moved = workspace_sharing.update_board_status(
            "token-owner-0123456789",
            {"shareId": share["id"], "status": "in-progress"},
        )

        self.assertEqual("in-progress", moved["boardStatus"])
        self.assertEqual("owner", moved["boardStatusUpdatedBy"])
        self.assertGreaterEqual(moved["boardStatusUpdatedAt"], share["boardStatusUpdatedAt"])
        self.assertEqual(file_revision, moved["updatedAt"])
        peer_view = workspace_sharing.list_shares("token-peer-01234567890")[0]
        self.assertEqual("in-progress", peer_view["boardStatus"])
        self.assertEqual("owner", peer_view["boardStatusUpdatedBy"])

    def test_board_status_requires_owner_or_contribute_permission(self):
        share = self.create()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.update_board_status(
                "token-peer-01234567890",
                {"shareId": share["id"], "status": "completed"},
            )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.update_board_status(
                "token-other-0123456789",
                {"shareId": share["id"], "status": "completed"},
            )

        workspace_sharing.update_share(
            "token-owner-0123456789",
            {"id": share["id"], "displayName": "프로젝트 보드", "permission": "contribute"},
        )
        moved = workspace_sharing.update_board_status(
            "token-peer-01234567890",
            {"shareId": share["id"], "status": "in-review"},
        )
        self.assertEqual("in-review", moved["boardStatus"])
        self.assertEqual("peer", moved["boardStatusUpdatedBy"])

    def test_board_status_route_and_validation(self):
        share = self.create()
        status, result = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/status/update",
            "Bearer token-owner-0123456789",
            {"shareId": share["id"], "status": "completed"},
        )
        self.assertEqual(200, status)
        self.assertEqual("completed", result["share"]["boardStatus"])

        status, result = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/status/update",
            "Bearer token-owner-0123456789",
            {"shareId": share["id"], "status": "../../done"},
        )
        self.assertEqual(400, status)
        self.assertFalse(result["ok"])

    def test_existing_share_catalog_migrates_board_status_columns(self):
        with workspace_sharing._database() as conn:
            conn.execute("DROP TABLE workspace_shares")
            conn.execute(
                """CREATE TABLE workspace_shares (
                id TEXT PRIMARY KEY, owner_login TEXT NOT NULL, owner_profile TEXT NOT NULL,
                display_name TEXT NOT NULL, repository_url TEXT NOT NULL,
                default_branch TEXT, description TEXT, permission TEXT NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER,
                source_kind TEXT NOT NULL DEFAULT 'nextcloud', storage_path TEXT
                )"""
            )

        with workspace_sharing._database() as conn:
            columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(workspace_shares)")
            }
        self.assertTrue(
            {"board_status", "board_status_updated_by", "board_status_updated_at"}.issubset(
                columns
            )
        )

    def test_rejects_git_and_legacy_clients(self):
        for source_kind in (None, "git"):
            with self.subTest(source_kind=source_kind), self.assertRaises(
                workspace_sharing.WorkspaceShareError
            ):
                workspace_sharing.create_share(
                    "token-owner-0123456789",
                    {
                        "displayName": "bad",
                        "sourceKind": source_kind,
                        "repositoryUrl": "https://github.com/samwoo/project.git",
                        "permission": "download",
                    },
                )

    def test_legacy_git_rows_are_not_exposed(self):
        share = self.create()
        with workspace_sharing._database() as conn:
            conn.execute(
                "UPDATE workspace_shares SET source_kind='git' WHERE id=?",
                (share["id"],),
            )

        self.assertEqual(
            [], workspace_sharing.list_shares("token-peer-01234567890")
        )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_sharing.list_comments(
                "token-peer-01234567890", {"shareId": share["id"]}
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

    def test_nextcloud_share_is_profile_scoped(self):
        share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "팀 자료",
                "sourceKind": "nextcloud",
                "permission": "download",
            },
        )
        self.assertNotIn("sourceKind", share)
        self.assertNotIn("repositoryUrl", share)
        self.assertNotIn("storagePath", share)
        self.assertEqual([], workspace_sharing.list_shares("token-other-0123456789"))
        self.ensure_workspace.assert_called_with("ai_center", share["id"])

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
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "download"},
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
                "permission": "download",
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
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "download"},
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
            {"displayName": "팀 자료", "sourceKind": "nextcloud", "permission": "download"},
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
