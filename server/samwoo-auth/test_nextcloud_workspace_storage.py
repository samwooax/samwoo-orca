import unittest
from unittest import mock

import nextcloud_workspace_storage


class NextcloudWorkspaceStorageTest(unittest.TestCase):
    SHARE_ID = "123e4567-e89b-42d3-a456-426614174000"

    def test_normalizes_windows_and_posix_relative_paths(self):
        self.assertEqual(
            "reports/summary.docx",
            nextcloud_workspace_storage.normalize_relative_path(
                r"reports\summary.docx", allow_empty=False
            ),
        )

    def test_rejects_parent_traversal_and_absolute_paths(self):
        for value in ("../secret", "reports/../../secret", "/../secret", "C:\\secret"):
            with self.subTest(value=value), self.assertRaises(
                nextcloud_workspace_storage.NextcloudStorageError
            ):
                nextcloud_workspace_storage.normalize_relative_path(
                    value, allow_empty=False
                )

    def test_rejects_invalid_profile_storage_identity(self):
        with self.assertRaises(nextcloud_workspace_storage.NextcloudStorageError):
            nextcloud_workspace_storage._workspace_segments(
                "../finance", "00000000-0000-0000-0000-000000000000"
            )

    def test_rejects_non_uuid_share_identity(self):
        with self.assertRaises(nextcloud_workspace_storage.NextcloudStorageError):
            nextcloud_workspace_storage._workspace_segments(
                "ai_center", "123e4567-e89b-42d3-a456-42661417400-"
            )

    @mock.patch("nextcloud_workspace_storage._request")
    def test_uses_only_successful_propstat_properties(self, request):
        request.return_value = (
            207,
            f'''<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:">
              <d:response>
                <d:href>/remote.php/dav/files/user/SAMWOO-Workspaces/ai_center/{self.SHARE_ID}/note.txt</d:href>
                <d:propstat><d:prop><d:getetag>wrong</d:getetag></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
                <d:propstat><d:prop><d:getetag>"right"</d:getetag><d:getcontentlength>2</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
              </d:response>
            </d:multistatus>'''.encode(),
            {},
        )

        entries = nextcloud_workspace_storage.list_directory(
            "ai_center", self.SHARE_ID
        )

        self.assertEqual("right", entries[0]["etag"])

    @mock.patch("nextcloud_workspace_storage._request")
    def test_create_only_write_sends_if_none_match(self, request):
        request.return_value = (201, b"", {"etag": '"new"'})

        result = nextcloud_workspace_storage.write_file(
            "ai_center", self.SHARE_ID, "note.txt", "b2s=", create_only=True
        )

        self.assertEqual("new", result["etag"])
        self.assertEqual("*", request.call_args.kwargs["headers"]["If-None-Match"])

    @mock.patch("nextcloud_workspace_storage._request")
    def test_existing_write_sends_if_match_instead_of_create_condition(self, request):
        request.return_value = (204, b"", {"etag": '"new"'})

        nextcloud_workspace_storage.write_file(
            "ai_center",
            self.SHARE_ID,
            "note.txt",
            "b2s=",
            expected_etag='"old"',
            create_only=True,
        )

        headers = request.call_args.kwargs["headers"]
        self.assertEqual('"old"', headers["If-Match"])
        self.assertNotIn("If-None-Match", headers)


if __name__ == "__main__":
    unittest.main()
