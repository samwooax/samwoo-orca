"""Install the profile-scoped workspace catalog into the live auth service."""

from __future__ import annotations

import pathlib
import py_compile
import shutil
import time
import urllib.request

ROOT = pathlib.Path("/opt/samwoo-auth")
AUTH_SERVER = ROOT / "auth-server.py"
RAW_ROOT = "https://raw.githubusercontent.com/samwooax/samwoo-orca/main/server/samwoo-auth"
MODULES = ("workspace_sharing.py", "workspace_share_endpoints.py")

ROUTE_BLOCK = '''        if workspace_share_endpoints.is_workspace_share_path(self.path):
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                body = {}
            status, payload = workspace_share_endpoints.handle_workspace_share(
                self.path, self.headers.get("Authorization"), body
            )
            self._send(status, payload)
            return

'''


def download_modules() -> None:
    for filename in MODULES:
        destination = ROOT / filename
        temporary = destination.with_suffix(destination.suffix + ".new")
        with urllib.request.urlopen(f"{RAW_ROOT}/{filename}", timeout=30) as response:
            temporary.write_bytes(response.read())
        temporary.chmod(0o600)
        temporary.replace(destination)


def patch_auth_server() -> pathlib.Path | None:
    source = AUTH_SERVER.read_text(encoding="utf-8")
    if "import workspace_sharing" in source:
        return None
    import_anchor = "import mail_endpoints\n"
    route_anchor = "        if mail_endpoints.is_mail_path(self.path):\n"
    role_anchor = '        role = entry["role"]\n'
    for anchor in (import_anchor, route_anchor, role_anchor):
        if source.count(anchor) != 1:
            raise RuntimeError(f"auth-server.py integration anchor changed: {anchor.strip()}")
    patched = source.replace(
        import_anchor,
        import_anchor + "import workspace_sharing\nimport workspace_share_endpoints\n",
    )
    patched = patched.replace(route_anchor, ROUTE_BLOCK + route_anchor)
    patched = patched.replace(
        role_anchor,
        role_anchor + "        workspace_sharing.bind_session(token, working_user, role)\n",
    )
    backup = AUTH_SERVER.with_name(f"auth-server.py.bak-{int(time.time())}")
    shutil.copy2(AUTH_SERVER, backup)
    temporary = AUTH_SERVER.with_suffix(".py.new")
    temporary.write_text(patched, encoding="utf-8")
    py_compile.compile(str(temporary), doraise=True)
    temporary.replace(AUTH_SERVER)
    return backup


def main() -> None:
    if not AUTH_SERVER.is_file():
        raise RuntimeError(f"missing {AUTH_SERVER}")
    download_modules()
    backup = patch_auth_server()
    for filename in (*MODULES, AUTH_SERVER.name):
        py_compile.compile(str(ROOT / filename), doraise=True)
    if backup:
        print(f"WORKSPACE_SHARING_INSTALLED backup={backup}")
    else:
        print("WORKSPACE_SHARING_ALREADY_INSTALLED")


if __name__ == "__main__":
    main()
