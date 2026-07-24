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
    mail_send(token, to, subject, body, cc=None)
    revoke_session(token)
    purge_expired()                            # call opportunistically
"""

from __future__ import annotations

import email
import imaplib
import logging
import os
import secrets
import smtplib
import threading
import time
from email.header import decode_header, make_header
from email.mime.text import MIMEText
from email.utils import formataddr, getaddresses, parseaddr

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
        msg = email.message_from_bytes(data[0][1])
        return {
            "uid": str(uid),
            "from": _dec(msg.get("From")),
            "to": _dec(msg.get("To")),
            "subject": _dec(msg.get("Subject")),
            "date": _dec(msg.get("Date")),
            "body": _body_text(msg),
        }
    finally:
        try:
            conn.logout()
        except Exception:
            pass


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
