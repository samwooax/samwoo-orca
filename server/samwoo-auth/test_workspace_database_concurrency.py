import os
import tempfile
import threading
import time
import unittest

import workspace_sharing


class WorkspaceDatabaseConcurrencyTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        with workspace_sharing._database():
            pass

    def tearDown(self):
        self.tempdir.cleanup()

    def test_wal_reader_continues_while_writer_transaction_is_open(self):
        writer_started = threading.Event()
        release_writer = threading.Event()
        writer_errors = []

        def write_session():
            try:
                with workspace_sharing._database() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    conn.execute(
                        "INSERT INTO workspace_sessions VALUES (?,?,?,?)",
                        ("hash", "owner", "ai_center", int(time.time()) + 60),
                    )
                    writer_started.set()
                    release_writer.wait(2)
            except Exception as error:
                writer_errors.append(error)

        writer = threading.Thread(target=write_session)
        writer.start()
        self.assertTrue(writer_started.wait(1))
        started_at = time.monotonic()
        with workspace_sharing._database() as conn:
            count = conn.execute("SELECT COUNT(*) FROM workspace_sessions").fetchone()[0]
            pragmas = {
                "journal": conn.execute("PRAGMA journal_mode").fetchone()[0],
                "busy": conn.execute("PRAGMA busy_timeout").fetchone()[0],
                "sync": conn.execute("PRAGMA synchronous").fetchone()[0],
                "foreign": conn.execute("PRAGMA foreign_keys").fetchone()[0],
            }
        elapsed = time.monotonic() - started_at
        release_writer.set()
        writer.join(2)

        self.assertEqual(0, count)
        self.assertLess(elapsed, 1)
        self.assertEqual({"journal": "wal", "busy": 5000, "sync": 1, "foreign": 1}, pragmas)
        self.assertEqual([], writer_errors)


if __name__ == "__main__":
    unittest.main()
