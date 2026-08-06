import unittest

import nextcloud_workspace_storage


class NextcloudWorkspaceStorageTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
