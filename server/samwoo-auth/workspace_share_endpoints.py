"""HTTP routing adapter for workspace_sharing."""

from __future__ import annotations

import workspace_sharing

_ROUTES = {
    "/workspace-shares/list", "/workspace-shares/create",
    "/workspace-shares/update", "/workspace-shares/revoke",
    "/workspace-shares/comments/list", "/workspace-shares/comments/create",
    "/workspace-shares/comments/complete",
}


def is_workspace_share_path(path: str) -> bool:
    return path in _ROUTES


def _bearer(header: str | None) -> str:
    if not header or not header.startswith("Bearer "):
        raise workspace_sharing.WorkspaceShareError("missing bearer token")
    return header[len("Bearer "):].strip()


def handle_workspace_share(path: str, auth_header: str | None, body: dict) -> tuple[int, dict]:
    try:
        token = _bearer(auth_header)
        if path == "/workspace-shares/list":
            return 200, {"ok": True, "shares": workspace_sharing.list_shares(token)}
        if path == "/workspace-shares/create":
            return 200, {"ok": True, "share": workspace_sharing.create_share(token, body)}
        if path == "/workspace-shares/update":
            return 200, {"ok": True, "share": workspace_sharing.update_share(token, body)}
        if path == "/workspace-shares/revoke":
            workspace_sharing.revoke_share(token, body)
            return 200, {"ok": True}
        if path == "/workspace-shares/comments/list":
            return 200, {"ok": True, **workspace_sharing.list_comments(token, body)}
        if path == "/workspace-shares/comments/create":
            return 200, {"ok": True, "comment": workspace_sharing.create_comment(token, body)}
        if path == "/workspace-shares/comments/complete":
            comment = workspace_sharing.set_comment_completed(token, body)
            return 200, {"ok": True, "comment": comment}
        return 404, {"ok": False, "error": "not found"}
    except workspace_sharing.WorkspaceShareError as error:
        message = str(error)
        status = 401 if "session" in message or "bearer" in message else 400
        return status, {"ok": False, "error": message}
    except Exception:
        return 500, {"ok": False, "error": "internal error"}
