"""Profile-scoped shared Git workspace catalog for SAMWOO-ORCA."""

from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
import uuid
from urllib.parse import urlparse

DB_PATH = os.environ.get("SAMWOO_WORKSPACE_DB", "/opt/samwoo-auth/workspace-shares.db")
SESSION_TTL = int(os.environ.get("SAMWOO_WORKSPACE_SESSION_TTL", str(8 * 3600)))
_PERMISSIONS = {"view", "clone", "contribute"}
_SCP_REMOTE = re.compile(r"^(?:[^@\s:]+@)?[^:\s]+:.+$")
_sessions: dict[str, dict] = {}
_lock = threading.RLock()


class WorkspaceShareError(Exception):
    pass


def bind_session(token: str, login: str, profile: str, ttl: int = SESSION_TTL) -> None:
    """Bind server-issued auth to its resolved profile; clients cannot select scope."""
    if not token or not login or not profile:
        raise WorkspaceShareError("workspace profile required")
    with _lock:
        _sessions[token] = {"login": login, "profile": profile, "expires": time.time() + ttl}


def revoke_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def _identity(token: str) -> tuple[str, str]:
    with _lock:
        session = _sessions.get(token)
        if not session or session["expires"] <= time.time():
            _sessions.pop(token, None)
            raise WorkspaceShareError("invalid or expired session")
        return session["login"], session["profile"]


def _connect() -> sqlite3.Connection:
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, mode=0o700, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS workspace_shares (
        id TEXT PRIMARY KEY, owner_login TEXT NOT NULL, owner_profile TEXT NOT NULL,
        display_name TEXT NOT NULL, repository_url TEXT NOT NULL,
        default_branch TEXT, description TEXT, permission TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS workspace_shares_profile_idx ON workspace_shares(owner_profile, revoked_at)"
    )
    conn.commit()
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass
    return conn


def _text(value: object, field: str, maximum: int, required: bool = False) -> str:
    result = str(value or "").strip()
    if required and not result:
        raise WorkspaceShareError(f"{field} required")
    if len(result) > maximum or any(ord(char) < 32 for char in result):
        raise WorkspaceShareError(f"invalid {field}")
    return result


def _remote(value: object) -> str:
    remote = _text(value, "repository url", 2048, True)
    if re.match(r"^[A-Za-z]:[\\/]", remote):
        raise WorkspaceShareError("unsupported repository url")
    if remote.lower().startswith(("file:", "http:", "ftp:", "data:", "javascript:")):
        raise WorkspaceShareError("unsupported repository url")
    if _SCP_REMOTE.match(remote) and "://" not in remote:
        return remote
    parsed = urlparse(remote)
    has_unsafe_userinfo = bool(parsed.password) or (parsed.scheme == "https" and bool(parsed.username))
    if parsed.scheme not in {"https", "ssh"} or not parsed.hostname or has_unsafe_userinfo:
        raise WorkspaceShareError("unsupported repository url")
    return remote


def _permission(value: object) -> str:
    permission = str(value or "")
    if permission not in _PERMISSIONS:
        raise WorkspaceShareError("invalid permission")
    return permission


def _serialize(row: sqlite3.Row, login: str) -> dict:
    return {
        "id": row["id"], "ownerLogin": row["owner_login"],
        "ownerProfile": row["owner_profile"], "displayName": row["display_name"],
        "repositoryUrl": row["repository_url"], "defaultBranch": row["default_branch"],
        "description": row["description"], "permission": row["permission"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "isOwner": row["owner_login"] == login,
    }


def list_shares(token: str) -> list[dict]:
    login, profile = _identity(token)
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM workspace_shares WHERE owner_profile=? AND revoked_at IS NULL ORDER BY updated_at DESC",
            (profile,),
        ).fetchall()
    return [_serialize(row, login) for row in rows]


def create_share(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    now = int(time.time() * 1000)
    values = (
        str(uuid.uuid4()), login, profile,
        _text(body.get("displayName"), "display name", 120, True),
        _remote(body.get("repositoryUrl")),
        _text(body.get("defaultBranch"), "default branch", 255) or None,
        _text(body.get("description"), "description", 1000) or None,
        _permission(body.get("permission")), now, now,
    )
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO workspace_shares (id,owner_login,owner_profile,display_name,repository_url,default_branch,description,permission,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            values,
        )
        row = conn.execute("SELECT * FROM workspace_shares WHERE id=?", (values[0],)).fetchone()
    return _serialize(row, login)


def update_share(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _text(body.get("id"), "share id", 64, True)
    values = (
        _text(body.get("displayName"), "display name", 120, True),
        _text(body.get("description"), "description", 1000) or None,
        _permission(body.get("permission")), int(time.time() * 1000),
        share_id, login, profile,
    )
    with _lock, _connect() as conn:
        cursor = conn.execute(
            "UPDATE workspace_shares SET display_name=?,description=?,permission=?,updated_at=? WHERE id=? AND owner_login=? AND owner_profile=? AND revoked_at IS NULL",
            values,
        )
        if cursor.rowcount != 1:
            raise WorkspaceShareError("share not found or not owner")
        row = conn.execute("SELECT * FROM workspace_shares WHERE id=?", (share_id,)).fetchone()
    return _serialize(row, login)


def revoke_share(token: str, body: dict) -> None:
    login, profile = _identity(token)
    share_id = _text(body.get("id"), "share id", 64, True)
    with _lock, _connect() as conn:
        cursor = conn.execute(
            "UPDATE workspace_shares SET revoked_at=?,updated_at=? WHERE id=? AND owner_login=? AND owner_profile=? AND revoked_at IS NULL",
            (int(time.time() * 1000), int(time.time() * 1000), share_id, login, profile),
        )
        if cursor.rowcount != 1:
            raise WorkspaceShareError("share not found or not owner")
