"""Canonical employee login identities and one-time database migration."""

from __future__ import annotations

import sqlite3
import time

_MIGRATION_PREFIX = "canonical-login-v1:"


def canonical_login(value: object) -> str:
    result = str(value if value is not None else "").strip()
    if "@" in result:
        result = result.split("@", 1)[0]
    return result.lower()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _migration_applied(conn: sqlite3.Connection, table: str) -> bool:
    name = f"{_MIGRATION_PREFIX}{table}"
    return conn.execute(
        "SELECT 1 FROM samwoo_data_migrations WHERE name=?", (name,)
    ).fetchone() is not None


def _record_migration(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO samwoo_data_migrations(name,applied_at) VALUES (?,?)",
        (f"{_MIGRATION_PREFIX}{table}", int(time.time() * 1000)),
    )


def _normalize_column(conn: sqlite3.Connection, table: str, column: str) -> None:
    rows = conn.execute(
        f"SELECT rowid,{column} AS login FROM {table} WHERE instr({column}, '@')>0"
    ).fetchall()
    for row in rows:
        login = canonical_login(row["login"])
        if login:
            conn.execute(f"UPDATE {table} SET {column}=? WHERE rowid=?", (login, row["rowid"]))


def _migrate_simple_table(
    conn: sqlite3.Connection, table: str, columns: tuple[str, ...]
) -> None:
    available = _table_columns(conn, table)
    if not available or _migration_applied(conn, table):
        return
    for column in columns:
        if column in available:
            _normalize_column(conn, table, column)
    _record_migration(conn, table)


def _migrate_assignees(conn: sqlite3.Connection) -> None:
    table = "workspace_share_assignees"
    if not _table_columns(conn, table) or _migration_applied(conn, table):
        return
    rows = conn.execute(f"SELECT rowid,* FROM {table}").fetchall()
    groups: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for row in rows:
        login = canonical_login(row["assignee_login"])
        key = (
            row["share_id"],
            login if "@" in row["assignee_login"] else row["assignee_login"],
        )
        groups.setdefault(key, []).append(row)
    for (share_id, login), group in groups.items():
        if not login or not any("@" in row["assignee_login"] for row in group):
            continue
        winner = max(group, key=lambda row: (row["assigned_at"], row["rowid"]))
        conn.executemany(f"DELETE FROM {table} WHERE rowid=?", [(row["rowid"],) for row in group])
        conn.execute(
            f"INSERT INTO {table}(share_id,assignee_login,assigned_by,assigned_at) VALUES (?,?,?,?)",
            (share_id, login, canonical_login(winner["assigned_by"]), winner["assigned_at"]),
        )
    _normalize_column(conn, table, "assigned_by")
    _record_migration(conn, table)


def _migrate_message_reads(conn: sqlite3.Connection) -> None:
    table = "profile_message_reads"
    if not _table_columns(conn, table) or _migration_applied(conn, table):
        return
    rows = conn.execute(f"SELECT rowid,* FROM {table}").fetchall()
    groups: dict[tuple[str, str, str], list[sqlite3.Row]] = {}
    for row in rows:
        login = canonical_login(row["login"])
        key = (
            row["owner_profile"],
            login if "@" in row["login"] else row["login"],
            row["channel_key"],
        )
        groups.setdefault(key, []).append(row)
    for (profile, login, channel), group in groups.items():
        if not login or not any("@" in row["login"] for row in group):
            continue
        winner = max(group, key=lambda row: (row["last_read_created_at"], row["last_read_id"]))
        conn.executemany(f"DELETE FROM {table} WHERE rowid=?", [(row["rowid"],) for row in group])
        conn.execute(
            f"INSERT INTO {table} VALUES (?,?,?,?,?)",
            (profile, login, channel, winner["last_read_created_at"], winner["last_read_id"]),
        )
    _record_migration(conn, table)


def _migrate_messages(conn: sqlite3.Connection) -> None:
    table = "profile_messages"
    columns = _table_columns(conn, table)
    # Why: workspace schema can initialize before messaging adds its legacy columns.
    if "client_message_id" not in columns or _migration_applied(conn, table):
        return
    rows = conn.execute(
        f"SELECT rowid,* FROM {table} WHERE client_message_id IS NOT NULL"
    ).fetchall()
    groups: dict[tuple[str, str, str, str], list[sqlite3.Row]] = {}
    for row in rows:
        login = canonical_login(row["author_login"])
        key = (
            row["owner_profile"],
            row["channel_key"],
            login if "@" in row["author_login"] else row["author_login"],
            row["client_message_id"],
        )
        groups.setdefault(key, []).append(row)
    for group in groups.values():
        if not any("@" in row["author_login"] for row in group):
            continue
        winner = max(group, key=lambda row: (row["created_at"], row["id"]))
        for row in group:
            if row["rowid"] == winner["rowid"]:
                continue
            conn.execute(
                f"UPDATE {table} SET reply_to_id=? WHERE reply_to_id=?",
                (winner["id"], row["id"]),
            )
            conn.execute(f"DELETE FROM {table} WHERE rowid=?", (row["rowid"],))
    _normalize_column(conn, table, "author_login")
    _record_migration(conn, table)


def migrate_login_identities(conn: sqlite3.Connection) -> None:
    """Normalize legacy email logins once per table without losing unique rows."""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS samwoo_data_migrations (
        name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
        )"""
    )
    _migrate_simple_table(conn, "workspace_sessions", ("login",))
    _migrate_simple_table(
        conn,
        "workspace_shares",
        (
            "owner_login",
            "board_status_updated_by",
            "assignees_updated_by",
            "due_date_updated_by",
        ),
    )
    _migrate_assignees(conn)
    _migrate_simple_table(
        conn,
        "workspace_work_items",
        ("assignee_login", "completed_by", "created_by", "updated_by"),
    )
    _migrate_simple_table(conn, "workspace_share_comments", ("author_login", "completed_by"))
    _migrate_messages(conn)
    _migrate_message_reads(conn)
