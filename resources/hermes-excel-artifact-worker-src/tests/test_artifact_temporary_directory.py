from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from orca_excel_artifact import artifact_temporary_directory as temporary_directory


class ArtifactTemporaryDirectoryTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows lock retry contract")
    def test_retries_a_transient_windows_cleanup_failure(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            path = Path(tempfile.mkdtemp(dir=parent))
            with (
                patch.object(
                    temporary_directory.shutil,
                    "rmtree",
                    side_effect=[PermissionError("locked"), None],
                ) as remove,
                patch.object(temporary_directory.time, "sleep") as sleep,
            ):
                temporary_directory._remove_directory(path)

        self.assertEqual(remove.call_count, 2)
        sleep.assert_called_once_with(0.05)

    def test_propagates_cleanup_failure_after_the_deadline(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            path = Path(tempfile.mkdtemp(dir=parent))
            with (
                patch.object(temporary_directory, "WINDOWS_CLEANUP_SECONDS", 0),
                patch.object(
                    temporary_directory.shutil,
                    "rmtree",
                    side_effect=PermissionError("still locked"),
                ),
                self.assertRaises(PermissionError),
            ):
                temporary_directory._remove_directory(path)


if __name__ == "__main__":
    unittest.main()
