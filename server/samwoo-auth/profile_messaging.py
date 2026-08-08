"""Profile-scoped team and workspace messaging for SAMWOO-ORCA."""

from __future__ import annotations

import sqlite3
import time
import uuid

import workspace_sharing

MESSAGE_PAGE_SIZE = 100
_CHANNEL_KINDS = {"team", "workspace"}


class ProfileMessagingError(Exception):
    pass


def _schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS profile_messages (
        id TEXT PRIMARY KEY, owner_profile TEXT NOT NULL, channel_key TEXT NOT NULL,
        channel_kind TEXT NOT NULL, share_id TEXT, author_login TEXT NOT NULL,
        body TEXT NOT NULL, reply_to_id TEXT, created_at INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS profile_messages_channel_idx ON profile_messages(owner_profile, channel_key, created_at, id)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS profile_message_reads (
        owner_profile TEXT NOT NULL, login TEXT NOT NULL, channel_key TEXT NOT NULL,
        last_read_created_at INTEGER NOT NULL, last_read_id TEXT NOT NULL,
        PRIMARY KEY(owner_profile, login, channel_key)
        )"""
    )


def _text(value: object, maximum: int) -> str:
    result = str(value or "").strip()
    if not result or len(result) > maximum:
        raise ProfileMessagingError("invalid message")
    if any(ord(char) < 32 and char not in "\n\t" for char in result):
        raise ProfileMessagingError("invalid message")
    return result


def _channel(conn: sqlite3.Connection, profile: str, body: dict) -> tuple[str, str, str | None]:
    kind = str(body.get("channelKind") or "")
    if kind not in _CHANNEL_KINDS:
        raise ProfileMessagingError("invalid message channel")
    if kind == "team":
        return "team", kind, None
    try:
        share_id = workspace_sharing._share_id(body.get("shareId"))
        workspace_sharing._require_active_share(conn, share_id, profile)
    except workspace_sharing.WorkspaceShareError as error:
        raise ProfileMessagingError(str(error)) from error
    return f"workspace:{share_id}", kind, share_id


def _cursor(body: dict) -> tuple[int, str] | None:
    created_at = body.get("beforeCreatedAt")
    message_id = body.get("beforeId")
    if created_at is None and message_id is None:
        return None
    if (
        not isinstance(created_at, int)
        or isinstance(created_at, bool)
        or created_at < 0
        or not isinstance(message_id, str)
        or not message_id
        or len(message_id) > 64
    ):
        raise ProfileMessagingError("invalid message cursor")
    return created_at, message_id


def _serialize_message(row: sqlite3.Row, login: str) -> dict:
    return {
        "id": row["id"], "channelKey": row["channel_key"],
        "channelKind": row["channel_kind"], "shareId": row["share_id"],
        "authorLogin": row["author_login"], "body": row["body"],
        "replyToId": row["reply_to_id"], "replyToAuthor": row["reply_author"],
        "replyToPreview": row["reply_preview"], "createdAt": row["created_at"],
        "isAuthor": row["author_login"] == login,
    }


def _message_select() -> str:
    return """SELECT message.*,
    reply.author_login AS reply_author, substr(reply.body, 1, 160) AS reply_preview
    FROM profile_messages message
    LEFT JOIN profile_messages reply ON reply.id=message.reply_to_id"""


def list_channels(token: str) -> list[dict]:
    login, profile = workspace_sharing._identity(token)
    with workspace_sharing._lock, workspace_sharing._database() as conn:
        _schema(conn)
        shares = conn.execute(
            """SELECT id,display_name FROM workspace_shares
            WHERE owner_profile=? AND source_kind='nextcloud' AND revoked_at IS NULL
            ORDER BY display_name COLLATE NOCASE, id""",
            (profile,),
        ).fetchall()
        definitions = [("team", "team", None, "Team chat")]
        definitions.extend(
            (f"workspace:{row['id']}", "workspace", row["id"], row["display_name"])
            for row in shares
        )
        latest_rows = conn.execute(
            """SELECT channel_key,author_login,body,created_at FROM (
            SELECT channel_key,author_login,body,created_at,id,
            ROW_NUMBER() OVER (
                PARTITION BY channel_key ORDER BY created_at DESC,id DESC
            ) AS message_rank
            FROM profile_messages WHERE owner_profile=?
            ) WHERE message_rank=1""",
            (profile,),
        ).fetchall()
        latest_by_channel = {row["channel_key"]: row for row in latest_rows}
        unread_rows = conn.execute(
            """SELECT message.channel_key,COUNT(*) AS unread_count
            FROM profile_messages message
            LEFT JOIN profile_message_reads read
            ON read.owner_profile=message.owner_profile AND read.login=?
            AND read.channel_key=message.channel_key
            WHERE message.owner_profile=? AND message.author_login!=?
            AND (read.channel_key IS NULL OR message.created_at>read.last_read_created_at
            OR (message.created_at=read.last_read_created_at AND message.id>read.last_read_id))
            GROUP BY message.channel_key""",
            (login, profile, login),
        ).fetchall()
        unread_by_channel = {
            row["channel_key"]: row["unread_count"] for row in unread_rows
        }
        channels = []
        for key, kind, share_id, label in definitions:
            last = latest_by_channel.get(key)
            channels.append({
                "key": key, "kind": kind, "shareId": share_id, "label": label,
                "unreadCount": unread_by_channel.get(key, 0),
                "lastMessageAt": last["created_at"] if last else None,
                "lastMessagePreview": last["body"][:160] if last else None,
                "lastMessageAuthor": last["author_login"] if last else None,
            })
    return channels


def list_messages(token: str, body: dict) -> dict:
    login, profile = workspace_sharing._identity(token)
    cursor = _cursor(body)
    with workspace_sharing._lock, workspace_sharing._database() as conn:
        _schema(conn)
        key, _, _ = _channel(conn, profile, body)
        cursor_clause = ""
        parameters: tuple = (profile, key, MESSAGE_PAGE_SIZE + 1)
        if cursor:
            cursor_clause = " AND (message.created_at<? OR (message.created_at=? AND message.id<?))"
            parameters = (profile, key, cursor[0], cursor[0], cursor[1], MESSAGE_PAGE_SIZE + 1)
        rows = conn.execute(
            f"""{_message_select()} WHERE message.owner_profile=? AND message.channel_key=?
            {cursor_clause} ORDER BY message.created_at DESC,message.id DESC LIMIT ?""",
            parameters,
        ).fetchall()
    has_more = len(rows) > MESSAGE_PAGE_SIZE
    return {
        "messages": [_serialize_message(row, login) for row in reversed(rows[:MESSAGE_PAGE_SIZE])],
        "hasMore": has_more,
    }


def send_message(token: str, body: dict) -> dict:
    login, profile = workspace_sharing._identity(token)
    message_body = _text(body.get("body"), 4000)
    reply_to_id = str(body.get("replyToId") or "").strip() or None
    if reply_to_id and len(reply_to_id) > 64:
        raise ProfileMessagingError("invalid reply")
    now = int(time.time() * 1000)
    with workspace_sharing._lock, workspace_sharing._database() as conn:
        _schema(conn)
        key, kind, share_id = _channel(conn, profile, body)
        if reply_to_id:
            reply = conn.execute(
                "SELECT 1 FROM profile_messages WHERE id=? AND owner_profile=? AND channel_key=?",
                (reply_to_id, profile, key),
            ).fetchone()
            if not reply:
                raise ProfileMessagingError("reply message not found")
        message_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO profile_messages
            (id,owner_profile,channel_key,channel_kind,share_id,author_login,body,reply_to_id,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (message_id, profile, key, kind, share_id, login, message_body, reply_to_id, now),
        )
        row = conn.execute(
            f"{_message_select()} WHERE message.id=?", (message_id,)
        ).fetchone()
    return _serialize_message(row, login)


def mark_read(token: str, body: dict) -> None:
    login, profile = workspace_sharing._identity(token)
    message_id = str(body.get("messageId") or "")
    if not message_id or len(message_id) > 64:
        raise ProfileMessagingError("invalid message id")
    with workspace_sharing._lock, workspace_sharing._database() as conn:
        _schema(conn)
        key, _, _ = _channel(conn, profile, body)
        row = conn.execute(
            """SELECT created_at,id FROM profile_messages
            WHERE id=? AND owner_profile=? AND channel_key=?""",
            (message_id, profile, key),
        ).fetchone()
        if not row:
            raise ProfileMessagingError("message not found")
        conn.execute(
            """INSERT INTO profile_message_reads
            (owner_profile,login,channel_key,last_read_created_at,last_read_id)
            VALUES (?,?,?,?,?) ON CONFLICT(owner_profile,login,channel_key) DO UPDATE SET
            last_read_created_at=excluded.last_read_created_at,last_read_id=excluded.last_read_id
            WHERE excluded.last_read_created_at>profile_message_reads.last_read_created_at
            OR (excluded.last_read_created_at=profile_message_reads.last_read_created_at
                AND excluded.last_read_id>profile_message_reads.last_read_id)""",
            (profile, login, key, row["created_at"], row["id"]),
        )
