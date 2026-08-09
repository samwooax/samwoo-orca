import os
import tempfile
import unittest
from unittest import mock

import workspace_share_endpoints
import workspace_sharing
import workspace_work_items


class WorkspaceWorkItemsTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        workspace_sharing._sessions.clear()
        workspace_sharing.bind_session("token-owner-0123456789", "owner", "ai_center")
        workspace_sharing.bind_session("token-peer-01234567890", "peer", "ai_center")
        workspace_sharing.bind_session("token-other-0123456789", "other", "sales")
        mock.patch(
            "workspace_sharing.nextcloud_workspace_storage.ensure_workspace",
            return_value="SAMWOO-Workspaces/profile/share-id",
        ).start()
        mock.patch(
            "workspace_work_items.profile_display_names.profile_members",
            side_effect=lambda profile: {
                "ai_center": [
                    {"login": "owner", "name": "Owner"},
                    {"login": "peer", "name": "Peer"},
                ],
                "sales": [{"login": "other", "name": "Other"}],
            }.get(profile, []),
        ).start()
        self.share = workspace_sharing.create_share(
            "token-owner-0123456789",
            {
                "displayName": "작업 보드",
                "sourceKind": "nextcloud",
                "permission": "download",
            },
        )

    def tearDown(self):
        mock.patch.stopall()
        self.tempdir.cleanup()

    def create_item(self):
        return workspace_work_items.create_item(
            "token-owner-0123456789",
            {"shareId": self.share["id"], "title": "도면 검토"},
        )

    def test_create_complete_assign_and_share_counts(self):
        file_revision = self.share["updatedAt"]
        item = self.create_item()
        self.assertEqual("도면 검토", item["title"])
        self.assertFalse(item["completed"])

        assigned = workspace_work_items.set_assignee(
            "token-owner-0123456789",
            {
                "shareId": self.share["id"],
                "workItemId": item["id"],
                "assigneeLogin": "PEER",
            },
        )
        self.assertEqual("peer", assigned["assigneeLogin"])

        completed = workspace_work_items.set_completed(
            "token-owner-0123456789",
            {
                "shareId": self.share["id"],
                "workItemId": item["id"],
                "completed": True,
            },
        )
        self.assertTrue(completed["completed"])
        self.assertEqual("owner", completed["completedBy"])
        self.assertGreater(completed["completedAt"], 0)

        peer_items = workspace_work_items.list_items(
            "token-peer-01234567890", {"shareId": self.share["id"]}
        )
        self.assertEqual([completed["id"]], [row["id"] for row in peer_items])
        summary = workspace_sharing.list_shares("token-peer-01234567890")[0]
        self.assertEqual(1, summary["workItemCount"])
        self.assertEqual(1, summary["completedWorkItemCount"])
        self.assertEqual(file_revision, summary["updatedAt"])

    def test_contributor_can_mutate_but_download_member_cannot(self):
        item = self.create_item()
        for action in (
            lambda: workspace_work_items.create_item(
                "token-peer-01234567890",
                {"shareId": self.share["id"], "title": "차단"},
            ),
            lambda: workspace_work_items.set_completed(
                "token-peer-01234567890",
                {
                    "shareId": self.share["id"],
                    "workItemId": item["id"],
                    "completed": True,
                },
            ),
        ):
            with self.assertRaises(workspace_sharing.WorkspaceShareError):
                action()

        workspace_sharing.update_share(
            "token-owner-0123456789",
            {
                "id": self.share["id"],
                "displayName": "작업 보드",
                "permission": "contribute",
            },
        )
        created = workspace_work_items.create_item(
            "token-peer-01234567890",
            {"shareId": self.share["id"], "title": "기여자 작업"},
        )
        self.assertEqual("peer", created["createdBy"])

    def test_rejects_cross_profile_and_non_member_assignment(self):
        item = self.create_item()
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_work_items.list_items(
                "token-other-0123456789", {"shareId": self.share["id"]}
            )
        with self.assertRaises(workspace_sharing.WorkspaceShareError):
            workspace_work_items.set_assignee(
                "token-owner-0123456789",
                {
                    "shareId": self.share["id"],
                    "workItemId": item["id"],
                    "assigneeLogin": "outsider",
                },
            )

    def test_routes_and_clear_assignee(self):
        status, created = workspace_share_endpoints.handle_workspace_share(
            "/workspace-shares/work-items/create",
            "Bearer token-owner-0123456789",
            {"shareId": self.share["id"], "title": "라우트 작업"},
        )
        self.assertEqual(200, status)
        item_id = created["workItem"]["id"]

        for path, body in (
            (
                "/workspace-shares/work-items/assignee",
                {"shareId": self.share["id"], "workItemId": item_id, "assigneeLogin": None},
            ),
            (
                "/workspace-shares/work-items/complete",
                {"shareId": self.share["id"], "workItemId": item_id, "completed": True},
            ),
            ("/workspace-shares/work-items/list", {"shareId": self.share["id"]}),
        ):
            with self.subTest(path=path):
                status, result = workspace_share_endpoints.handle_workspace_share(
                    path, "Bearer token-owner-0123456789", body
                )
                self.assertEqual(200, status)
                self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()
