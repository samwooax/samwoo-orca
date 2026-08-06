import pathlib
import tempfile
import unittest
from unittest import mock

import install_workspace_sharing


class InstallWorkspaceSharingTest(unittest.TestCase):
    def test_refuses_an_unknown_existing_route_shape(self):
        source = '''import workspace_sharing
import workspace_share_endpoints

if workspace_share_endpoints.is_workspace_share_path(self.path):
    custom_route_handler()
'''
        with tempfile.TemporaryDirectory() as tempdir:
            auth_server = pathlib.Path(tempdir) / "auth-server.py"
            auth_server.write_text(source, encoding="utf-8")
            with mock.patch.object(install_workspace_sharing, "AUTH_SERVER", auth_server):
                with self.assertRaisesRegex(RuntimeError, "cannot be safely upgraded"):
                    install_workspace_sharing.patch_auth_server()

    def test_accepts_an_already_capped_route(self):
        source = '''import workspace_sharing
import workspace_share_endpoints

if workspace_share_endpoints.is_workspace_share_path(self.path):
    if length > 1:
        error = "workspace request is too large"
'''
        with tempfile.TemporaryDirectory() as tempdir:
            auth_server = pathlib.Path(tempdir) / "auth-server.py"
            auth_server.write_text(source, encoding="utf-8")
            with mock.patch.object(install_workspace_sharing, "AUTH_SERVER", auth_server):
                self.assertIsNone(install_workspace_sharing.patch_auth_server())


if __name__ == "__main__":
    unittest.main()
