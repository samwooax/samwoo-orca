"""Install the profile-scoped workspace catalog into the live auth service."""

from __future__ import annotations

import pathlib
import py_compile
import secrets
import shutil
import subprocess
import time
import urllib.request

ROOT = pathlib.Path("/opt/samwoo-auth")
AUTH_SERVER = ROOT / "auth-server.py"
RAW_ROOT = "https://raw.githubusercontent.com/samwooax/samwoo-orca/main/server/samwoo-auth"
MODULES = (
    "nextcloud_workspace_storage.py",
    "profile_messaging.py",
    "workspace_sharing.py",
    "workspace_share_endpoints.py",
)
NEXTCLOUD_URL = "https://nextcloud-ebml.srv1808091.hstgr.cloud"
NEXTCLOUD_USER = "orca-workspaces"
NEXTCLOUD_ENV = pathlib.Path("/etc/samwoo-auth-workspace.env")
SERVICE_DROP_IN = pathlib.Path("/etc/systemd/system/samwoo-auth.service.d/workspace.conf")

ROUTE_BLOCK = '''        if workspace_share_endpoints.is_workspace_share_path(self.path):
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > 24 * 1024 * 1024:
                self._send(413, {"ok": False, "error": "workspace request is too large"})
                return
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


def _nextcloud_container() -> str:
    names = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    preferred = "nextcloud-ebml-nextcloud-1"
    if preferred in names:
        return preferred
    candidates = [
        name for name in names
        if "nextcloud" in name.lower()
        and not any(part in name.lower() for part in ("cron", "db", "maria", "redis"))
    ]
    if len(candidates) != 1:
        raise RuntimeError("could not identify the Nextcloud application container")
    return candidates[0]


def _write_root_secret(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".new")
    temporary.write_text(content, encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def _create_nextcloud_service_account(container: str, password: str) -> None:
    user_info = subprocess.run(
        ["docker", "exec", "-u", "www-data", container, "php", "occ", "user:info", NEXTCLOUD_USER],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    action = (
        f"php occ user:resetpassword --password-from-env {NEXTCLOUD_USER}"
        if user_info.returncode == 0
        else f"php occ user:add --password-from-env --display-name 'SAMWOO Workspace Service' {NEXTCLOUD_USER}"
    )
    subprocess.run(
        [
            "docker", "exec", "-i", "-u", "www-data", container,
            "sh", "-c", f"IFS= read -r OC_PASS; export OC_PASS; {action}",
        ],
        input=f"{password}\n",
        check=True,
        text=True,
        stdout=subprocess.DEVNULL,
    )


def configure_nextcloud_workspace() -> None:
    if not NEXTCLOUD_ENV.is_file():
        password = secrets.token_urlsafe(36)
        _create_nextcloud_service_account(_nextcloud_container(), password)
        _write_root_secret(
            NEXTCLOUD_ENV,
            "\n".join(
                (
                    f'SAMWOO_NEXTCLOUD_URL="{NEXTCLOUD_URL}"',
                    f'SAMWOO_NEXTCLOUD_USERNAME="{NEXTCLOUD_USER}"',
                    f'SAMWOO_NEXTCLOUD_APP_PASSWORD="{password}"',
                    'SAMWOO_NEXTCLOUD_WORKSPACE_ROOT="SAMWOO-Workspaces"',
                    "",
                )
            ),
        )
    _write_root_secret(
        SERVICE_DROP_IN,
        "[Service]\nEnvironmentFile=/etc/samwoo-auth-workspace.env\n",
    )


def patch_auth_server() -> pathlib.Path | None:
    source = AUTH_SERVER.read_text(encoding="utf-8")
    if "import workspace_sharing" in source:
        legacy_route = '''        if workspace_share_endpoints.is_workspace_share_path(self.path):
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
        has_route = "workspace_share_endpoints.is_workspace_share_path(self.path)" in source
        has_request_cap = "workspace request is too large" in source
        if legacy_route not in source and has_route and has_request_cap:
            return None
        if legacy_route not in source:
            raise RuntimeError("existing workspace route cannot be safely upgraded")
        patched = source.replace(legacy_route, ROUTE_BLOCK)
        backup = AUTH_SERVER.with_name(f"auth-server.py.bak-{int(time.time())}")
        shutil.copy2(AUTH_SERVER, backup)
        temporary = AUTH_SERVER.with_suffix(".py.new")
        temporary.write_text(patched, encoding="utf-8")
        py_compile.compile(str(temporary), doraise=True)
        temporary.replace(AUTH_SERVER)
        return backup
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
    configure_nextcloud_workspace()
    for filename in (*MODULES, AUTH_SERVER.name):
        py_compile.compile(str(ROOT / filename), doraise=True)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "restart", "samwoo-auth"], check=True)
    subprocess.run(["systemctl", "is-active", "--quiet", "samwoo-auth"], check=True)
    if backup:
        print(f"WORKSPACE_SHARING_INSTALLED backup={backup}")
    else:
        print("WORKSPACE_SHARING_ALREADY_INSTALLED")


if __name__ == "__main__":
    main()
