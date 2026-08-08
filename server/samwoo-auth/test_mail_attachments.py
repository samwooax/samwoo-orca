import base64
from email.header import Header
from email.message import EmailMessage
import os
import tempfile
import unittest
from unittest import mock
from urllib.parse import quote_from_bytes

import mail_endpoints
import mail_ext
import nextcloud_workspace_storage
import workspace_sharing


class _FakeImap:
    def __init__(self, raw_message: bytes):
        self.raw_message = raw_message

    def select(self, mailbox, readonly=True):
        return "OK", []

    def uid(self, operation, uid, query):
        return "OK", [(b"1 (RFC822)", self.raw_message)]

    def logout(self):
        return "BYE", []


def _part(payload: bytes, content_type: str, disposition: str) -> EmailMessage:
    part = EmailMessage()
    part["Content-Type"] = content_type
    part["Content-Disposition"] = disposition
    part["Content-Transfer-Encoding"] = "base64"
    part.set_payload(base64.b64encode(payload).decode("ascii"))
    return part


def _message(*parts: EmailMessage) -> bytes:
    message = EmailMessage()
    message["From"] = "sender@example.com"
    message["To"] = "owner@example.com"
    message["Subject"] = "Attachments"
    message["Date"] = "Fri, 8 Aug 2026 12:00:00 +0900"
    message.set_content("body text")
    message.make_mixed()
    for part in parts:
        message.attach(part)
    return message.as_bytes()


class MailAttachmentPipelineTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        workspace_sharing.DB_PATH = os.path.join(self.tempdir.name, "shares.db")
        workspace_sharing._sessions.clear()
        workspace_sharing._initialized_database_versions.clear()
        mail_ext._sessions.clear()
        self.ensure_workspace = mock.patch(
            "workspace_sharing.nextcloud_workspace_storage.ensure_workspace",
            return_value="SAMWOO-Workspaces/ai_center/share-id",
        ).start()
        self.owner_token = self._session("owner", "ai_center")
        self.peer_token = self._session("peer", "ai_center")
        self.other_token = self._session("other", "sales")

    def tearDown(self):
        mock.patch.stopall()
        mail_ext._sessions.clear()
        workspace_sharing._sessions.clear()
        workspace_sharing._initialized_database_versions.clear()
        self.tempdir.cleanup()

    def _session(self, login: str, profile: str) -> str:
        token = mail_ext.new_session(f"{login}@example.com", "secret")
        workspace_sharing.bind_session(token, login, profile)
        return token

    def _create_share(self, permission: str = "contribute") -> dict:
        return workspace_sharing.create_share(
            self.owner_token,
            {
                "displayName": "부품 리스트",
                "sourceKind": "nextcloud",
                "permission": permission,
            },
        )

    def _imap(self, raw_message: bytes):
        return mock.patch("mail_ext._imap", return_value=(_FakeImap(raw_message), "owner"))

    def test_lists_rfc2047_rfc2231_euc_kr_and_inline_attachments(self):
        rfc2047 = Header("견적서.pdf", "euc-kr").encode()
        rfc2231 = quote_from_bytes("부품 목록.xlsx".encode("euc-kr"))
        raw = _message(
            _part(b"pdf", "application/pdf", f'attachment; filename="{rfc2047}"'),
            _part(
                b"sheet",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                f"attachment; filename*=euc-kr''{rfc2231}",
            ),
            _part(b"image", "image/png", 'inline; filename="inline.png"'),
            _part(b"raw", "application/octet-stream", "attachment"),
        )

        with self._imap(raw):
            attachments = mail_ext.mail_attachments_list(self.owner_token, "42")

        self.assertEqual([0, 1, 2, 3], [item["index"] for item in attachments])
        self.assertEqual(
            ["견적서.pdf", "부품 목록.xlsx", "inline.png", "attachment-3"],
            [item["filename"] for item in attachments],
        )
        self.assertEqual([3, 5, 5, 3], [item["size"] for item in attachments])

    def test_rejects_oversize_and_traversal_target_and_sanitizes_filename(self):
        self.assertEqual(16 * 1024 * 1024, mail_ext.MAX_ATTACHMENT_BYTES)
        share = self._create_share()
        raw = _message(
            _part(b"large", "application/octet-stream", 'attachment; filename="../../secret.txt"')
        )
        write_file = mock.Mock(
            return_value={"path": "mail/.._.._secret.txt", "etag": "etag", "size": 5}
        )
        with self._imap(raw), mock.patch.object(mail_ext, "MAX_ATTACHMENT_BYTES", 4):
            with self.assertRaisesRegex(mail_ext.MailError, "attachment too large"):
                mail_ext.mail_attachment_save_to_workspace(
                    self.owner_token, "42", 0, share["id"]
                )
        with self._imap(raw), mock.patch.object(
            nextcloud_workspace_storage, "write_file", write_file
        ):
            result = mail_ext.mail_attachment_save_to_workspace(
                self.owner_token, "42", 0, share["id"]
            )
            with self.assertRaisesRegex(mail_ext.MailError, "invalid target path"):
                mail_ext.mail_attachment_save_to_workspace(
                    self.owner_token, "42", 0, share["id"], "../outside.txt"
                )

        self.assertEqual("mail/.._.._secret.txt", result["path"])
        self.assertEqual("mail/.._.._secret.txt", write_file.call_args.args[2])

    def test_rejects_view_other_profile_and_revoked_shares(self):
        share = self._create_share("view")
        raw = _message(_part(b"x", "text/plain", 'attachment; filename="note.txt"'))

        with self._imap(raw), mock.patch.object(nextcloud_workspace_storage, "write_file"):
            with self.assertRaisesRegex(mail_ext.MailError, "contribution is not allowed"):
                mail_ext.mail_attachment_save_to_workspace(
                    self.peer_token, "42", 0, share["id"]
                )
            with self.assertRaisesRegex(mail_ext.MailError, "not found"):
                mail_ext.mail_attachment_save_to_workspace(
                    self.other_token, "42", 0, share["id"]
                )
            workspace_sharing.revoke_share(self.owner_token, {"id": share["id"]})
            with self.assertRaisesRegex(mail_ext.MailError, "not found"):
                mail_ext.mail_attachment_save_to_workspace(
                    self.owner_token, "42", 0, share["id"]
                )

    def test_retries_create_only_collision_with_numbered_suffix(self):
        share = self._create_share()
        raw = _message(_part(b"pdf", "application/pdf", 'attachment; filename="quote.pdf"'))
        paths: list[str] = []

        def write_file(profile, share_id, path, content_base64, create_only=False):
            paths.append(path)
            self.assertTrue(create_only)
            if len(paths) == 1:
                raise nextcloud_workspace_storage.NextcloudStorageConflictError("exists")
            return {"path": path, "etag": "new", "size": 3}

        with self._imap(raw), mock.patch.object(
            nextcloud_workspace_storage, "write_file", side_effect=write_file
        ):
            result = mail_ext.mail_attachment_save_to_workspace(
                self.owner_token, "42", 0, share["id"]
            )

        self.assertEqual(["mail/quote.pdf", "mail/quote (2).pdf"], paths)
        self.assertEqual("mail/quote (2).pdf", result["path"])

    def test_mail_read_preserves_fields_and_adds_attachments(self):
        raw = _message(_part(b"pdf", "application/pdf", 'attachment; filename="quote.pdf"'))

        with self._imap(raw):
            result = mail_ext.mail_read(self.owner_token, "42")

        self.assertEqual("42", result["uid"])
        self.assertEqual("sender@example.com", result["from"])
        self.assertEqual("owner@example.com", result["to"])
        self.assertEqual("Attachments", result["subject"])
        self.assertEqual("body text\n", result["body"])
        self.assertEqual("quote.pdf", result["attachments"][0]["filename"])
        with self._imap(_message()):
            self.assertEqual([], mail_ext.mail_read(self.owner_token, "43")["attachments"])

    def test_save_updates_share_revision(self):
        share = self._create_share()
        with workspace_sharing._database() as conn:
            conn.execute("UPDATE workspace_shares SET updated_at=1 WHERE id=?", (share["id"],))
        raw = _message(_part(b"pdf", "application/pdf", 'attachment; filename="quote.pdf"'))
        saved = {"path": "mail/quote.pdf", "etag": "new", "size": 3}

        with self._imap(raw), mock.patch.object(
            nextcloud_workspace_storage, "write_file", return_value=saved
        ):
            mail_ext.mail_attachment_save_to_workspace(
                self.owner_token, "42", 0, share["id"]
            )

        self.assertGreater(workspace_sharing.list_shares(self.owner_token)[0]["updatedAt"], 1)

    def test_routes_list_and_save_without_returning_attachment_body(self):
        list_result = [{"index": 0, "filename": "quote.pdf", "size": 3, "contentType": "application/pdf"}]
        save_result = {"path": "mail/quote.pdf", "size": 3, "etag": "new", "shareId": "share"}
        with mock.patch.object(mail_ext, "mail_attachments_list", return_value=list_result), mock.patch.object(
            mail_ext, "mail_attachment_save_to_workspace", return_value=save_result
        ):
            status, listed = mail_endpoints.handle_mail(
                "/mail/attachments/list", f"Bearer {self.owner_token}", {"uid": "42"}
            )
            save_status, saved = mail_endpoints.handle_mail(
                "/mail/attachments/save-to-workspace",
                f"Bearer {self.owner_token}",
                {"uid": "42", "index": 0, "shareId": "share"},
            )

        self.assertEqual(200, status)
        self.assertEqual(list_result, listed["attachments"])
        self.assertEqual(200, save_status)
        self.assertEqual(save_result, saved["file"])
        self.assertNotIn("contentBase64", saved["file"])


if __name__ == "__main__":
    unittest.main()
