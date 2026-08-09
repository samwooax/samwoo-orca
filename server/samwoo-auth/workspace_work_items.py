"""Profile-scoped work items attached to shared workspaces."""

from __future__ import annotations

import time
import uuid

import profile_display_names
import workspace_sharing

MAX_ITEMS_PER_SHARE = 200


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "shareId": row["share_id"],
        "title": row["title"],
        "assigneeLogin": row["assignee_login"],
        "completed": bool(row["completed"]),
        "completedBy": row["completed_by"],
        "completedAt": row["completed_at"],
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedBy": row["updated_by"],
        "updatedAt": row["updated_at"],
    }


def _work_item_id(value: object) -> str:
    item_id = str(value or "")
    try:
        if str(uuid.UUID(item_id)) != item_id.lower():
            raise ValueError
    except ValueError as error:
        raise workspace_sharing.WorkspaceShareError("invalid work item id") from error
    return item_id


def _require_contribution(conn, share_id: str, profile: str, login: str):
    share = workspace_sharing._nextcloud_share(conn, share_id, profile)
    if share["owner_login"] != login and share["permission"] != "contribute":
        raise workspace_sharing.WorkspaceShareError("workspace work item contribution is not allowed")
    return share


def _require_item(conn, share_id: str, item_id: str):
    row = conn.execute(
        "SELECT * FROM workspace_work_items WHERE id=? AND share_id=?",
        (item_id, share_id),
    ).fetchone()
    if not row:
        raise workspace_sharing.WorkspaceShareError("work item not found")
    return row


def list_items(token: str, body: dict) -> list[dict]:
    _, profile = workspace_sharing._identity(token)
    share_id = workspace_sharing._share_id(body.get("shareId"))
    with workspace_sharing._database() as conn:
        workspace_sharing._require_active_share(conn, share_id, profile)
        rows = conn.execute(
            "SELECT * FROM workspace_work_items WHERE share_id=? ORDER BY created_at,id",
            (share_id,),
        ).fetchall()
    return [_serialize(row) for row in rows]


def create_item(token: str, body: dict) -> dict:
    login, profile = workspace_sharing._identity(token)
    share_id = workspace_sharing._share_id(body.get("shareId"))
    title = workspace_sharing._text(body.get("title"), "work item title", 300, True)
    now = int(time.time() * 1000)
    item_id = str(uuid.uuid4())
    with workspace_sharing._database() as conn:
        _require_contribution(conn, share_id, profile, login)
        count = conn.execute(
            "SELECT COUNT(*) FROM workspace_work_items WHERE share_id=?", (share_id,)
        ).fetchone()[0]
        if count >= MAX_ITEMS_PER_SHARE:
            raise workspace_sharing.WorkspaceShareError("workspace work item limit reached")
        conn.execute(
            """INSERT INTO workspace_work_items
            (id,share_id,title,created_by,created_at,updated_by,updated_at)
            VALUES (?,?,?,?,?,?,?)""",
            (item_id, share_id, title, login, now, login, now),
        )
        row = _require_item(conn, share_id, item_id)
    return _serialize(row)


def set_completed(token: str, body: dict) -> dict:
    login, profile = workspace_sharing._identity(token)
    share_id = workspace_sharing._share_id(body.get("shareId"))
    item_id = _work_item_id(body.get("workItemId"))
    completed = body.get("completed")
    if not isinstance(completed, bool):
        raise workspace_sharing.WorkspaceShareError("invalid work item completion")
    now = int(time.time() * 1000)
    with workspace_sharing._database() as conn:
        _require_contribution(conn, share_id, profile, login)
        _require_item(conn, share_id, item_id)
        conn.execute(
            """UPDATE workspace_work_items SET completed=?,completed_by=?,completed_at=?,
            updated_by=?,updated_at=? WHERE id=? AND share_id=?""",
            (
                completed,
                login if completed else None,
                now if completed else None,
                login,
                now,
                item_id,
                share_id,
            ),
        )
        row = _require_item(conn, share_id, item_id)
    return _serialize(row)


def set_assignee(token: str, body: dict) -> dict:
    login, profile = workspace_sharing._identity(token)
    share_id = workspace_sharing._share_id(body.get("shareId"))
    item_id = _work_item_id(body.get("workItemId"))
    raw_assignee = body.get("assigneeLogin")
    if raw_assignee is None or raw_assignee == "":
        assignee = None
    else:
        requested = workspace_sharing._text(raw_assignee, "assignee login", 160, True)
        members = {
            member["login"].casefold(): member["login"]
            for member in profile_display_names.profile_members(profile)
        }
        assignee = members.get(requested.casefold())
        if assignee is None:
            raise workspace_sharing.WorkspaceShareError("assignee is not a profile member")
    now = int(time.time() * 1000)
    with workspace_sharing._database() as conn:
        _require_contribution(conn, share_id, profile, login)
        _require_item(conn, share_id, item_id)
        conn.execute(
            """UPDATE workspace_work_items SET assignee_login=?,updated_by=?,updated_at=?
            WHERE id=? AND share_id=?""",
            (assignee, login, now, item_id, share_id),
        )
        row = _require_item(conn, share_id, item_id)
    return _serialize(row)
