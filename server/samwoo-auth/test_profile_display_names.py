import os
import tempfile
import time
import unittest
from unittest import mock

import profile_display_names


class ProfileDisplayNamesTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.display_path = os.path.join(self.tempdir.name, "display.csv")
        self.role_path = os.path.join(self.tempdir.name, "roles.csv")
        self.environment = mock.patch.dict(
            os.environ,
            {
                "SAMWOO_DISPLAY_NAMES_CSV": self.display_path,
                "SAMWOO_ROLE_MAP_CSV": self.role_path,
            },
        )
        self.environment.start()
        profile_display_names._reset_cache_for_tests()

    def tearDown(self):
        self.environment.stop()
        profile_display_names._reset_cache_for_tests()
        self.tempdir.cleanup()

    def write(self, path, content):
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)

    def test_dedicated_csv_accepts_bom_and_skips_invalid_rows(self):
        self.write(self.role_path, "login,name,role\nalpha,Agent A,planning\n")
        self.write(self.display_path, "\ufefflogin,display_name\nalpha,홍길동\nbroken\n,빈 로그인\n")

        self.assertEqual("홍길동", profile_display_names.display_name("ALPHA"))
        self.assertEqual(
            [{"login": "alpha", "name": "홍길동"}],
            profile_display_names.profile_members("planning"),
        )

    def test_role_name_is_fallback_when_display_file_or_row_is_missing(self):
        self.write(self.role_path, "alpha,Agent A,planning\nbeta,Agent B,planning\n")
        self.write(self.display_path, "login,display_name\nalpha,가나다\n")

        self.assertEqual("가나다", profile_display_names.display_name("alpha"))
        self.assertEqual("Agent B", profile_display_names.display_name("beta"))
        os.unlink(self.display_path)
        self.assertEqual("Agent A", profile_display_names.display_name("alpha"))

    def test_email_login_uses_the_canonical_directory_key(self):
        self.write(self.role_path, "member,Member Name,planning\n")

        self.assertEqual(
            "Member Name", profile_display_names.display_name(" MEMBER@Company.Test ")
        )
        self.assertEqual(
            [{"login": "member", "name": "Member Name"}],
            profile_display_names.profile_members("planning"),
        )

    def test_missing_files_fail_open(self):
        self.assertIsNone(profile_display_names.display_name("unknown"))
        self.assertEqual([], profile_display_names.profile_members("planning"))

    def test_mtime_change_reloads_without_restart(self):
        self.write(self.role_path, "alpha,Agent A,planning\n")
        self.write(self.display_path, "alpha,이전 이름\n")
        self.assertEqual("이전 이름", profile_display_names.display_name("alpha"))
        time.sleep(0.002)
        self.write(self.display_path, "alpha,새로운 이름\n")
        os.utime(self.display_path, None)
        self.assertEqual("새로운 이름", profile_display_names.display_name("alpha"))

    def test_members_are_profile_scoped_and_sorted_by_name(self):
        self.write(
            self.role_path,
            "zeta,Z Agent,planning\nalpha,A Agent,planning\nother,O Agent,sales\n",
        )
        self.write(self.display_path, "zeta,홍길동\nalpha,가나다\nother,김영업\n")

        self.assertEqual(
            [{"login": "alpha", "name": "가나다"}, {"login": "zeta", "name": "홍길동"}],
            profile_display_names.profile_members("planning"),
        )


if __name__ == "__main__":
    unittest.main()
