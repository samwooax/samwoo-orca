"""Framework-agnostic glue between auth-server.py and mail_ext.

Keeps auth-server.py's HTTP handler tiny: it hands us the path, the
Authorization header, and the parsed JSON body; we return (status, dict).
The bearer token is the mail-session handle from ``mail_ext.new_session``.
"""

from __future__ import annotations

import mail_ext

_ROUTES = {"/mail/list", "/mail/read", "/mail/send"}


def is_mail_path(path: str) -> bool:
    return path in _ROUTES


def _bearer(auth_header: str | None) -> str:
    if not auth_header or not auth_header.startswith("Bearer "):
        raise mail_ext.MailError("missing bearer token")
    return auth_header[len("Bearer ") :].strip()


def handle_mail(path: str, auth_header: str | None, body: dict) -> tuple[int, dict]:
    """Dispatch a /mail/* request. Never raises; returns (status, json)."""
    try:
        token = _bearer(auth_header)
        mail_ext.purge_expired()
        if path == "/mail/list":
            items = mail_ext.mail_list(
                token,
                mailbox=body.get("mailbox", "INBOX"),
                limit=body.get("limit", 20),
            )
            return 200, {"ok": True, "messages": items}
        if path == "/mail/read":
            msg = mail_ext.mail_read(
                token,
                uid=str(body.get("uid", "")),
                mailbox=body.get("mailbox", "INBOX"),
            )
            return 200, {"ok": True, "message": msg}
        if path == "/mail/send":
            result = mail_ext.mail_send(
                token,
                to=body.get("to"),
                subject=body.get("subject", ""),
                body=body.get("body", ""),
                cc=body.get("cc"),
            )
            return 200, result
        return 404, {"ok": False, "error": "not found"}
    except mail_ext.MailError as e:
        # 401 for auth/session problems, 400 for the rest — no internals leaked.
        msg = str(e)
        status = 401 if "session" in msg or "bearer" in msg else 400
        return status, {"ok": False, "error": msg}
    except Exception:
        return 500, {"ok": False, "error": "internal error"}
