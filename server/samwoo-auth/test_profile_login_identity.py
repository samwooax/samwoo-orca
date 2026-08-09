import os
import tempfile
import unittest

import profile_messaging
from profile_login_identity import canonical_login, migrate_login_identities
import workspace_sharing


class ProfileLoginIdentityTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        workspace_sharing._sessions.clear()
        workspace_sharing._initialized_database_versions.clear()
        profile_messaging._schema_database_versions.clear()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_canonical_login(self):
        self.assertEqual("member", canonical_login(" MEMBER@Company.Test "))
        self.assertEqual("member", canonical_login("MEMBER"))
        self.assertEqual("", canonical_login(None))

    def test_migration_normalizes_all_identity_columns_and_merges_unique_rows(self):
        with workspace_sharing._database() as conn:
            profile_messaging._schema(conn)
            conn.execute("DELETE FROM samwoo_data_migrations")
            conn.execute(
                """INSERT INTO workspace_shares
                (id,owner_login,owner_profile,display_name,repository_url,permission,
                created_at,updated_at,source_kind,board_status_updated_by,
                assignees_updated_by,due_date_updated_by)
                VALUES ('share-1','OWNER@Company.Test','planning','Board','',
                'contribute',1,1,'nextcloud','OWNER@Company.Test',
                'OWNER@Company.Test','OWNER@Company.Test')"""
            )
            conn.executemany(
                "INSERT INTO workspace_share_assignees VALUES (?,?,?,?)",
                [
                    ("share-1", "member", "owner", 1),
                    ("share-1", "MEMBER@Company.Test", "OWNER@Company.Test", 2),
                ],
            )
            conn.execute(
                """INSERT INTO workspace_work_items
                (id,share_id,title,assignee_login,completed,completed_by,
                created_by,created_at,updated_by,updated_at)
                VALUES ('work-1','share-1','Task','MEMBER@Company.Test',1,
                'OWNER@Company.Test','OWNER@Company.Test',1,'MEMBER@Company.Test',2)"""
            )
            conn.execute(
                """INSERT INTO workspace_share_comments
                (id,share_id,author_login,body,completed,completed_by,created_at,updated_at)
                VALUES ('comment-1','share-1','MEMBER@Company.Test','Done',1,
                'OWNER@Company.Test',1,2)"""
            )
            conn.execute(
                "INSERT INTO workspace_sessions VALUES ('token-hash','MEMBER@Company.Test','planning',9999999999)"
            )
            conn.executemany(
                """INSERT INTO profile_messages
                (id,owner_profile,channel_key,channel_kind,author_login,body,
                reply_to_id,created_at,client_message_id)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                [
                    ("m-old", "planning", "team", "team", "member", "old", None, 1, "client-id-0001"),
                    ("m-new", "planning", "team", "team", "MEMBER@Company.Test", "new", None, 2, "client-id-0001"),
                    ("m-reply", "planning", "team", "team", "OTHER@Company.Test", "reply", "m-old", 3, None),
                ],
            )
            conn.executemany(
                "INSERT INTO profile_message_reads VALUES (?,?,?,?,?)",
                [
                    ("planning", "member", "team", 1, "m-old"),
                    ("planning", "MEMBER@Company.Test", "team", 2, "m-new"),
                ],
            )

            migrate_login_identities(conn)

            self.assertEqual(
                [("member", "owner", 2)],
                [tuple(row) for row in conn.execute(
                    "SELECT assignee_login,assigned_by,assigned_at FROM workspace_share_assignees"
                )],
            )
            self.assertEqual(
                [("m-new", "member", "new"), ("m-reply", "other", "reply")],
                [tuple(row) for row in conn.execute(
                    "SELECT id,author_login,body FROM profile_messages ORDER BY created_at"
                )],
            )
            self.assertEqual(
                "m-new",
                conn.execute("SELECT reply_to_id FROM profile_messages WHERE id='m-reply'").fetchone()[0],
            )
            self.assertEqual(
                ("member", 2, "m-new"),
                tuple(conn.execute(
                    "SELECT login,last_read_created_at,last_read_id FROM profile_message_reads"
                ).fetchone()),
            )
            identity_columns = {
                "workspace_sessions": ("login",),
                "workspace_shares": ("owner_login", "board_status_updated_by", "assignees_updated_by", "due_date_updated_by"),
                "workspace_work_items": ("assignee_login", "completed_by", "created_by", "updated_by"),
                "workspace_share_comments": ("author_login", "completed_by"),
            }
            for table, columns in identity_columns.items():
                for column in columns:
                    count = conn.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE instr({column}, '@')>0"
                    ).fetchone()[0]
                    self.assertEqual(0, count, f"{table}.{column}")

            before = conn.execute("SELECT name,applied_at FROM samwoo_data_migrations ORDER BY name").fetchall()
            migrate_login_identities(conn)
            after = conn.execute("SELECT name,applied_at FROM samwoo_data_migrations ORDER BY name").fetchall()
            self.assertEqual([tuple(row) for row in before], [tuple(row) for row in after])


if __name__ == "__main__":
    unittest.main()
