"""Profile-scoped shared Git workspace catalog for SAMWOO-ORCA."""

from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
import uuid
from urllib.parse import urlparse

import nextcloud_workspace_storage

DB_PATH = os.environ.get("SAMWOO_WORKSPACE_DB", "/opt/samwoo-auth/workspace-shares.db")
SESSION_TTL = int(os.environ.get("SAMWOO_WORKSPACE_SESSION_TTL", str(8 * 3600)))
_PERMISSIONS = {"view", "clone", "contribute"}
_SOURCE_KINDS = {"git", "nextcloud"}
_SCP_REMOTE = re.compile(r"^(?:[^@\s:]+@)?[^:\s]+:.+$")
_SHARE_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
COMMENT_PAGE_SIZE = 50
_sessions: dict[str, dict] = {}
_lock = threading.RLock()


class WorkspaceShareError(Exception):
    pass


class WorkspaceShareConflictError(WorkspaceShareError):
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
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER,
        source_kind TEXT NOT NULL DEFAULT 'git', storage_path TEXT
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS workspace_shares_profile_idx ON workspace_shares(owner_profile, revoked_at)"
    )
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(workspace_shares)").fetchall()
    }
    if "source_kind" not in columns:
        conn.execute("ALTER TABLE workspace_shares ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'git'")
    if "storage_path" not in columns:
        conn.execute("ALTER TABLE workspace_shares ADD COLUMN storage_path TEXT")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS workspace_share_comments (
        id TEXT PRIMARY KEY, share_id TEXT NOT NULL, author_login TEXT NOT NULL,
        body TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        completed_by TEXT, completed_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS workspace_comments_share_idx ON workspace_share_comments(share_id, created_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS workspace_comments_cursor_idx ON workspace_share_comments(share_id, created_at, id)"
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


def _comment_text(value: object) -> str:
    result = str(value or "").strip()
    if not result:
        raise WorkspaceShareError("comment required")
    if len(result) > 2000 or any(ord(char) < 32 and char not in "\n\t" for char in result):
        raise WorkspaceShareError("invalid comment")
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


def _source_kind(value: object) -> str:
    source_kind = str(value or "git")
    if source_kind not in _SOURCE_KINDS:
        raise WorkspaceShareError("invalid workspace source")
    return source_kind


def _share_id(value: object) -> str:
    share_id = str(value or "")
    if not _SHARE_ID.fullmatch(share_id):
        raise WorkspaceShareError("invalid share id")
    return share_id


def _serialize(row: sqlite3.Row, login: str) -> dict:
    return {
        "id": row["id"], "ownerLogin": row["owner_login"],
        "ownerProfile": row["owner_profile"], "displayName": row["display_name"],
        "repositoryUrl": row["repository_url"], "defaultBranch": row["default_branch"],
        "description": row["description"], "permission": row["permission"],
        "sourceKind": row["source_kind"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "isOwner": row["owner_login"] == login,
        "commentCount": row["comment_count"] if "comment_count" in row.keys() else 0,
    }


def _serialize_comment(row: sqlite3.Row, login: str) -> dict:
    return {
        "id": row["id"], "shareId": row["share_id"],
        "authorLogin": row["author_login"], "body": row["body"],
        "completed": bool(row["completed"]), "completedBy": row["completed_by"],
        "completedAt": row["completed_at"], "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "isAuthor": row["author_login"] == login,
    }


def _require_active_share(conn: sqlite3.Connection, share_id: str, profile: str) -> None:
    row = conn.execute(
        "SELECT 1 FROM workspace_shares WHERE id=? AND owner_profile=? AND revoked_at IS NULL",
        (share_id, profile),
    ).fetchone()
    if not row:
        raise WorkspaceShareError("share not found")


def list_shares(token: str) -> list[dict]:
    login, profile = _identity(token)
    with _lock, _connect() as conn:
        rows = conn.execute(
            """SELECT workspace_shares.*,
            (SELECT COUNT(*) FROM workspace_share_comments
             WHERE workspace_share_comments.share_id=workspace_shares.id) AS comment_count
            FROM workspace_shares WHERE owner_profile=? AND revoked_at IS NULL
            ORDER BY updated_at DESC""",
            (profile,),
        ).fetchall()
    return [_serialize(row, login) for row in rows]


def create_share(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    now = int(time.time() * 1000)
    share_id = str(uuid.uuid4())
    source_kind = _source_kind(body.get("sourceKind"))
    repository_url = _remote(body.get("repositoryUrl")) if source_kind == "git" else ""
    storage_path = None
    if source_kind == "nextcloud":
        try:
            storage_path = nextcloud_workspace_storage.ensure_workspace(profile, share_id)
        except nextcloud_workspace_storage.NextcloudStorageError as error:
            raise WorkspaceShareError(str(error)) from error
    values = (
        share_id, login, profile,
        _text(body.get("displayName"), "display name", 120, True),
        repository_url,
        _text(body.get("defaultBranch"), "default branch", 255) or None,
        _text(body.get("description"), "description", 1000) or None,
        _permission(body.get("permission")), now, now, source_kind, storage_path,
    )
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO workspace_shares (id,owner_login,owner_profile,display_name,repository_url,default_branch,description,permission,created_at,updated_at,source_kind,storage_path) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            values,
        )
        row = conn.execute("SELECT * FROM workspace_shares WHERE id=?", (values[0],)).fetchone()
    return _serialize(row, login)


def update_share(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("id"))
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
    share_id = _share_id(body.get("id"))
    with _lock, _connect() as conn:
        cursor = conn.execute(
            "UPDATE workspace_shares SET revoked_at=?,updated_at=? WHERE id=? AND owner_login=? AND owner_profile=? AND revoked_at IS NULL",
            (int(time.time() * 1000), int(time.time() * 1000), share_id, login, profile),
        )
        if cursor.rowcount != 1:
            raise WorkspaceShareError("share not found or not owner")


def _nextcloud_share(
    conn: sqlite3.Connection, share_id: str, profile: str
) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM workspace_shares WHERE id=? AND owner_profile=? AND revoked_at IS NULL",
        (share_id, profile),
    ).fetchone()
    if row is None or row["source_kind"] != "nextcloud":
        raise WorkspaceShareError("Nextcloud workspace not found")
    return row


def list_workspace_files(token: str, body: dict) -> list[dict]:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    with _lock, _connect() as conn:
        row = _nextcloud_share(conn, share_id, profile)
        if row["permission"] == "view" and row["owner_login"] != login:
            raise WorkspaceShareError("workspace download is not allowed")
    try:
        return nextcloud_workspace_storage.list_directory(
            profile, share_id, body.get("path")
        )
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise WorkspaceShareError(str(error)) from error


def read_workspace_file(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    with _lock, _connect() as conn:
        row = _nextcloud_share(conn, share_id, profile)
        if row["permission"] == "view" and row["owner_login"] != login:
            raise WorkspaceShareError("workspace download is not allowed")
    try:
        return nextcloud_workspace_storage.read_file(profile, share_id, body.get("path"))
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise WorkspaceShareError(str(error)) from error


def write_workspace_file(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    with _lock, _connect() as conn:
        row = _nextcloud_share(conn, share_id, profile)
        if row["owner_login"] != login and row["permission"] != "contribute":
            raise WorkspaceShareError("workspace contribution is not allowed")
    create_only = body.get("createOnly", False)
    if not isinstance(create_only, bool):
        raise WorkspaceShareError("invalid create-only condition")
    try:
        result = nextcloud_workspace_storage.write_file(
            profile,
            share_id,
            body.get("path"),
            body.get("contentBase64"),
            body.get("expectedEtag"),
            create_only,
        )
    except nextcloud_workspace_storage.NextcloudStorageConflictError as error:
        raise WorkspaceShareConflictError(str(error)) from error
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise WorkspaceShareError(str(error)) from error
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE workspace_shares SET updated_at=? WHERE id=? AND owner_profile=?",
            (int(time.time() * 1000), share_id, profile),
        )
    return result


def delete_workspace_file(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    with _lock, _connect() as conn:
        row = _nextcloud_share(conn, share_id, profile)
        if row["owner_login"] != login and row["permission"] != "contribute":
            raise WorkspaceShareError("workspace contribution is not allowed")
    expected_etag = _text(body.get("expectedEtag"), "expected etag", 512, True)
    try:
        result = nextcloud_workspace_storage.delete_file(
            profile, share_id, body.get("path"), expected_etag
        )
    except nextcloud_workspace_storage.NextcloudStorageConflictError as error:
        raise WorkspaceShareConflictError(str(error)) from error
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise WorkspaceShareError(str(error)) from error
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE workspace_shares SET updated_at=? WHERE id=? AND owner_profile=?",
            (int(time.time() * 1000), share_id, profile),
        )
    return result


def list_comments(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    before_created_at = body.get("beforeCreatedAt")
    before_id = body.get("beforeId")
    has_cursor = before_created_at is not None or before_id is not None
    if has_cursor and (
        not isinstance(before_created_at, int)
        or isinstance(before_created_at, bool)
        or before_created_at < 0
        or not isinstance(before_id, str)
        or not before_id
        or len(before_id) > 64
        or any(ord(char) < 32 for char in before_id)
    ):
        raise WorkspaceShareError("invalid comment cursor")
    with _lock, _connect() as conn:
        _require_active_share(conn, share_id, profile)
        where_cursor = (
            " AND (created_at < ? OR (created_at = ? AND id < ?))"
            if has_cursor
            else ""
        )
        parameters = (
            (share_id, before_created_at, before_created_at, before_id, COMMENT_PAGE_SIZE + 1)
            if has_cursor
            else (share_id, COMMENT_PAGE_SIZE + 1)
        )
        rows = conn.execute(
            f"""SELECT * FROM workspace_share_comments
            WHERE share_id=?{where_cursor}
            ORDER BY created_at DESC, id DESC LIMIT ?""",
            parameters,
        ).fetchall()
        totals = conn.execute(
            """SELECT COUNT(*) AS comment_count,
            COALESCE(SUM(completed), 0) AS completed_count
            FROM workspace_share_comments WHERE share_id=?""",
            (share_id,),
        ).fetchone()
    has_more = len(rows) > COMMENT_PAGE_SIZE
    page = list(reversed(rows[:COMMENT_PAGE_SIZE]))
    oldest = page[0] if page else None
    return {
        "comments": [_serialize_comment(row, login) for row in page],
        "commentCount": totals["comment_count"],
        "completedCommentCount": totals["completed_count"],
        "hasMoreComments": has_more,
        "nextBeforeCreatedAt": oldest["created_at"] if has_more and oldest else None,
        "nextBeforeId": oldest["id"] if has_more and oldest else None,
    }


def create_comment(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    comment_body = _comment_text(body.get("body"))
    now = int(time.time() * 1000)
    values = (str(uuid.uuid4()), share_id, login, comment_body, now, now)
    with _lock, _connect() as conn:
        _require_active_share(conn, share_id, profile)
        conn.execute(
            "INSERT INTO workspace_share_comments (id,share_id,author_login,body,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            values,
        )
        row = conn.execute(
            "SELECT * FROM workspace_share_comments WHERE id=?", (values[0],)
        ).fetchone()
    return _serialize_comment(row, login)


def set_comment_completed(token: str, body: dict) -> dict:
    login, profile = _identity(token)
    share_id = _share_id(body.get("shareId"))
    comment_id = _text(body.get("commentId"), "comment id", 64, True)
    completed = body.get("completed")
    if not isinstance(completed, bool):
        raise WorkspaceShareError("invalid completed state")
    now = int(time.time() * 1000)
    with _lock, _connect() as conn:
        _require_active_share(conn, share_id, profile)
        # Why: a conditional write makes repeated stale requests preserve the first actor.
        conn.execute(
            """UPDATE workspace_share_comments
            SET completed=?,completed_by=?,completed_at=?,updated_at=?
            WHERE id=? AND share_id=? AND completed!=?""",
            (int(completed), login if completed else None, now if completed else None,
             now, comment_id, share_id, int(completed)),
        )
        row = conn.execute(
            "SELECT * FROM workspace_share_comments WHERE id=? AND share_id=?",
            (comment_id, share_id),
        ).fetchone()
        if row is None:
            raise WorkspaceShareError("comment not found")
    return _serialize_comment(row, login)
