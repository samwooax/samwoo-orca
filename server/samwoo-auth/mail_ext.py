"""SAMWOO-ORCA — session-scoped mail access for the auth service.

Security model (why this is shaped the way it is)
--------------------------------------------------
* The groupware credential is NEVER written to disk and NEVER logged. It lives
  only in this process's memory, inside a session that auto-expires (TTL), and
  is dropped on logout or process restart. A restart just forces re-login.
* If ``cryptography`` is installed, the secret is held encrypted with a
  process-ephemeral key (defense-in-depth against accidental log/heap dumps).
  Without it, the module still runs but logs a one-time warning.
* A session token authorizes exactly ONE mailbox — the endpoints derive the
  username from the token, so a leaked token can only touch its owner's mail,
  and the caller can never supply a different "from"/account.
* Prefer an app-specific password or OAuth token over the primary login
  password: pass whatever secret you like to ``new_session`` — the module does
  not care, it just uses it for IMAP/SMTP. See README for the OAuth path.

Public API
----------
    token = new_session(username, secret)      # returns opaque handle
    mail_list(token, mailbox="INBOX", limit=20)
    mail_read(token, uid, mailbox="INBOX")
    mail_attachments_list(token, uid, mailbox="INBOX")
    mail_attachment_save_to_workspace(token, uid, index, share_id)
    mail_send(token, to, subject, body, cc=None)
    revoke_session(token)
    purge_expired()                            # call opportunistically
"""

from __future__ import annotations

import base64
import email
import imaplib
import logging
import os
import posixpath
import re
import secrets
import smtplib
import threading
import time
from email.header import decode_header, make_header
from email.mime.text import MIMEText
from email.utils import collapse_rfc2231_value, formataddr, getaddresses, parseaddr

import nextcloud_workspace_storage
import workspace_sharing

log = logging.getLogger("samwoo-mail")

# --- config (env-overridable) ------------------------------------------------
IMAP_HOST = os.environ.get("SAMWOO_IMAP_HOST", "play.samwooeleco.com")
IMAP_PORT = int(os.environ.get("SAMWOO_IMAP_PORT", "993"))
SMTP_HOST = os.environ.get("SAMWOO_SMTP_HOST", "play.samwooeleco.com")
SMTP_PORT = int(os.environ.get("SAMWOO_SMTP_PORT", "587"))
SESSION_TTL = int(os.environ.get("SAMWOO_MAIL_TTL", str(8 * 3600)))  # 8h default
NET_TIMEOUT = int(os.environ.get("SAMWOO_MAIL_TIMEOUT", "20"))

# Send guardrails so a leaked token can't be used to blast mail.
MAX_RECIPIENTS = int(os.environ.get("SAMWOO_MAIL_MAX_RCPT", "20"))
MAX_BODY_BYTES = int(os.environ.get("SAMWOO_MAIL_MAX_BODY", str(256 * 1024)))
MAX_LIST_LIMIT = 50
MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024

# --- at-rest encryption of the in-memory secret (optional) -------------------
try:
    from cryptography.fernet import Fernet

    _FERNET = Fernet(Fernet.generate_key())  # ephemeral: gone on restart

    def _seal(s: str) -> bytes:
        return _FERNET.encrypt(s.encode("utf-8"))

    def _open(b: bytes) -> str:
        return _FERNET.decrypt(b).decode("utf-8")

except Exception:  # pragma: no cover - depends on host packages
    log.warning(
        "cryptography not installed — mail session secrets held in plaintext "
        "memory (still never persisted/logged). `pip install cryptography` to seal."
    )

    def _seal(s: str) -> bytes:
        return s.encode("utf-8")

    def _open(b: bytes) -> str:
        return b.decode("utf-8")


class MailError(Exception):
    """Raised for auth/connection/validation failures; message is caller-safe."""


# --- session store -----------------------------------------------------------
_sessions: dict[str, dict] = {}
_lock = threading.Lock()


def new_session(username: str, secret: str, ttl: int = SESSION_TTL) -> str:
    """Create a session and return an opaque URL-safe token.

    The token charset ([A-Za-z0-9_-]) matches the app-side MAIL_TOKEN_RE guard.
    """
    if not username or not secret:
        raise MailError("username and secret required")
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {
            "user": username,
            "sealed": _seal(secret),
            "expires": time.time() + ttl,
        }
    return token


def revoke_session(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def purge_expired() -> None:
    now = time.time()
    with _lock:
        for t in [t for t, s in _sessions.items() if s["expires"] <= now]:
            _sessions.pop(t, None)


def _resolve(token: str) -> tuple[str, str]:
    """Return (username, secret) for a live token or raise MailError."""
    with _lock:
        s = _sessions.get(token)
        if not s:
            raise MailError("invalid or expired session")
        if s["expires"] <= time.time():
            _sessions.pop(token, None)
            raise MailError("invalid or expired session")
        return s["user"], _open(s["sealed"])


# --- helpers -----------------------------------------------------------------
def _dec(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _decode_filename_value(value: object) -> str:
    if isinstance(value, tuple):
        value = collapse_rfc2231_value(value, errors="replace")
    text = str(value or "")
    try:
        chunks = decode_header(text)
    except Exception:
        return text
    decoded: list[str] = []
    for chunk, charset in chunks:
        if isinstance(chunk, str):
            decoded.append(chunk)
            continue
        encodings = [charset, "utf-8", "euc-kr", "cp949", "latin-1"]
        for encoding in encodings:
            if not encoding:
                continue
            try:
                decoded.append(chunk.decode(encoding))
                break
            except (LookupError, UnicodeDecodeError):
                continue
        else:
            decoded.append(chunk.decode("utf-8", "replace"))
    return "".join(decoded)


def _attachment_filename(part: email.message.Message, index: int) -> str:
    value = part.get_param("filename", header="content-disposition")
    if value is None:
        value = part.get_param("name", header="content-type")
    filename = _decode_filename_value(value or part.get_filename()).strip()
    return filename or f"attachment-{index}"


def _attachment_parts(msg: email.message.Message) -> list[tuple[int, email.message.Message]]:
    attachments: list[tuple[int, email.message.Message]] = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        disposition = part.get_content_disposition()
        has_filename = bool(part.get_filename())
        if disposition == "attachment" or (disposition == "inline" and has_filename):
            attachments.append((len(attachments), part))
    return attachments


def _attachment_record(index: int, part: email.message.Message) -> dict:
    payload = part.get_payload(decode=True) or b""
    return {
        "index": index,
        "filename": _attachment_filename(part, index),
        "size": len(payload),
        "contentType": part.get_content_type(),
    }


def _fetch_message(token: str, uid: str, mailbox: str) -> email.message.Message:
    if not str(uid).isdigit():
        raise MailError("invalid uid")
    conn, _ = _imap(token)
    try:
        typ, _ = conn.select(mailbox, readonly=True)
        if typ != "OK":
            raise MailError("mailbox not found")
        typ, data = conn.uid("fetch", str(uid), "(RFC822)")
        if typ != "OK" or not data or not isinstance(data[0], tuple):
            raise MailError("message not found")
        return email.message_from_bytes(data[0][1])
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _safe_attachment_filename(filename: str, index: int) -> str:
    sanitized = re.sub(r"[\\/]+", "_", filename)
    sanitized = "".join(char for char in sanitized if ord(char) >= 32 and ord(char) != 127)
    sanitized = sanitized.strip().rstrip(".")
    if sanitized in {"", ".", ".."}:
        sanitized = f"attachment-{index}"
    if len(sanitized) > 255:
        stem, suffix = posixpath.splitext(sanitized)
        sanitized = f"{stem[: max(1, 255 - len(suffix))]}{suffix}"
    try:
        return nextcloud_workspace_storage.normalize_relative_path(
            sanitized, allow_empty=False
        )
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise MailError("invalid attachment filename") from error


def _target_attachment_path(filename: str, index: int, target_path: object) -> str:
    candidate = (
        target_path
        if target_path is not None
        else f"mail/{_safe_attachment_filename(filename, index)}"
    )
    try:
        return nextcloud_workspace_storage.normalize_relative_path(
            candidate, allow_empty=False
        )
    except nextcloud_workspace_storage.NextcloudStorageError as error:
        raise MailError("invalid target path") from error


def _collision_path(path: str, sequence: int) -> str:
    directory, filename = posixpath.split(path)
    stem, suffix = posixpath.splitext(filename)
    next_name = f"{stem} ({sequence}){suffix}"
    return f"{directory}/{next_name}" if directory else next_name


def _imap(token: str) -> tuple[imaplib.IMAP4_SSL, str]:
    user, secret = _resolve(token)
    try:
        conn = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, timeout=NET_TIMEOUT)
        conn.login(user, secret)
    except imaplib.IMAP4.error:
        raise MailError("IMAP login failed")
    except OSError as e:
        raise MailError(f"IMAP connection failed: {e.__class__.__name__}")
    return conn, user


def _body_text(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(
                part.get("Content-Disposition", "")
            ):
                payload = part.get_payload(decode=True) or b""
                return payload.decode(part.get_content_charset() or "utf-8", "replace")
        # fall back to first text/html stripped-ish
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True) or b""
                return payload.decode(part.get_content_charset() or "utf-8", "replace")
        return ""
    payload = msg.get_payload(decode=True) or b""
    return payload.decode(msg.get_content_charset() or "utf-8", "replace")


# --- operations --------------------------------------------------------------
def mail_list(token: str, mailbox: str = "INBOX", limit: int = 20) -> list[dict]:
    limit = max(1, min(int(limit), MAX_LIST_LIMIT))
    conn, _ = _imap(token)
    try:
        typ, _ = conn.select(mailbox, readonly=True)
        if typ != "OK":
            raise MailError("mailbox not found")
        typ, data = conn.uid("search", None, "ALL")
        if typ != "OK":
            raise MailError("search failed")
        uids = data[0].split()[-limit:]
        out: list[dict] = []
        for uid in reversed(uids):
            typ, fetched = conn.uid(
                "fetch", uid, "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"
            )
            if typ != "OK" or not fetched or not isinstance(fetched[0], tuple):
                continue
            flags = fetched[0][0].decode("utf-8", "replace")
            hdr = email.message_from_bytes(fetched[0][1])
            out.append(
                {
                    "uid": uid.decode(),
                    "from": _dec(hdr.get("From")),
                    "subject": _dec(hdr.get("Subject")),
                    "date": _dec(hdr.get("Date")),
                    "seen": "\\Seen" in flags,
                }
            )
        return out
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def mail_read(token: str, uid: str, mailbox: str = "INBOX") -> dict:
    msg = _fetch_message(token, uid, mailbox)
    return {
        "uid": str(uid),
        "from": _dec(msg.get("From")),
        "to": _dec(msg.get("To")),
        "subject": _dec(msg.get("Subject")),
        "date": _dec(msg.get("Date")),
        "body": _body_text(msg),
        "attachments": [
            _attachment_record(index, part) for index, part in _attachment_parts(msg)
        ],
    }


def mail_attachments_list(
    token: str, uid: str, mailbox: str = "INBOX"
) -> list[dict]:
    msg = _fetch_message(token, uid, mailbox)
    return [_attachment_record(index, part) for index, part in _attachment_parts(msg)]


def mail_attachment_save_to_workspace(
    token: str,
    uid: str,
    index: int,
    share_id: str,
    target_path: object = None,
    mailbox: str = "INBOX",
) -> dict:
    _resolve(token)
    try:
        profile, normalized_share_id = workspace_sharing.require_workspace_write_access(
            token, share_id
        )
    except workspace_sharing.WorkspaceShareError as error:
        raise MailError(str(error)) from error

    if isinstance(index, bool):
        raise MailError("invalid attachment index")
    try:
        attachment_index = int(index)
    except (TypeError, ValueError) as error:
        raise MailError("invalid attachment index") from error
    if attachment_index < 0:
        raise MailError("invalid attachment index")

    msg = _fetch_message(token, uid, mailbox)
    parts = dict(_attachment_parts(msg))
    part = parts.get(attachment_index)
    if part is None:
        raise MailError("attachment not found")
    payload = part.get_payload(decode=True) or b""
    if len(payload) > min(MAX_ATTACHMENT_BYTES, nextcloud_workspace_storage.MAX_FILE_BYTES):
        raise MailError("attachment too large")

    filename = _attachment_filename(part, attachment_index)
    path = _target_attachment_path(filename, attachment_index, target_path)
    content_base64 = base64.b64encode(payload).decode("ascii")
    sequence = 1
    while True:
        try:
            result = nextcloud_workspace_storage.write_file(
                profile,
                normalized_share_id,
                path,
                content_base64,
                create_only=True,
            )
            break
        except nextcloud_workspace_storage.NextcloudStorageConflictError:
            sequence += 1
            if sequence > 1_000:
                raise MailError("no available attachment filename")
            path = _collision_path(
                _target_attachment_path(filename, attachment_index, target_path), sequence
            )
        except nextcloud_workspace_storage.NextcloudStorageError as error:
            raise MailError(str(error)) from error

    workspace_sharing.touch_workspace_share(profile, normalized_share_id)
    return {
        "path": result["path"],
        "size": result["size"],
        "etag": result.get("etag", ""),
        "shareId": normalized_share_id,
    }


def mail_send(
    token: str,
    to: str | list[str],
    subject: str,
    body: str,
    cc: str | list[str] | None = None,
) -> dict:
    user, secret = _resolve(token)

    def _addrs(v) -> list[str]:
        if not v:
            return []
        raw = v if isinstance(v, list) else [v]
        return [a for _, a in getaddresses(raw) if a and "@" in a]

    to_list, cc_list = _addrs(to), _addrs(cc)
    recipients = to_list + cc_list
    if not recipients:
        raise MailError("no valid recipients")
    if len(recipients) > MAX_RECIPIENTS:
        raise MailError(f"too many recipients (max {MAX_RECIPIENTS})")
    if len((body or "").encode("utf-8")) > MAX_BODY_BYTES:
        raise MailError("message body too large")

    # From is pinned to the session owner; the caller cannot spoof another sender.
    from_addr = user if "@" in user else parseaddr(user)[1] or user
    msg = MIMEText(body or "", "plain", "utf-8")
    msg["From"] = formataddr(("", from_addr))
    msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    msg["Subject"] = str(make_header([(subject or "", "utf-8")]))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=NET_TIMEOUT) as s:
            s.starttls()
            s.login(user, secret)
            s.sendmail(from_addr, recipients, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise MailError("SMTP login failed")
    except (smtplib.SMTPException, OSError) as e:
        raise MailError(f"send failed: {e.__class__.__name__}")
    return {"ok": True, "to": to_list, "cc": cc_list}
