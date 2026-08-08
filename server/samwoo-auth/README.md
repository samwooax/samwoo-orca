# samwoo-auth extensions

This directory also contains profile-scoped workspace sharing:

- `nextcloud_workspace_storage.py` — profile-path-safe WebDAV file storage.
- `workspace_sharing.py` — SQLite catalog, profile sessions, file permissions, and comments.
- `workspace_share_endpoints.py` — `/workspace-shares/*` HTTP routing adapter.
- `test_workspace_sharing.py` — isolation, ownership, revocation and URL safety tests.
- `test_workspace_comments.py` — pagination, concurrency and comment authorization tests.
- `test_nextcloud_workspace_storage.py` — WebDAV path and identity boundary tests.

Deployment integration is documented in `docs/SAMWOO_WORKSPACE_SHARING.md`.

## Messenger scale integration (server prerequisite first)

### 0. Confirm a threaded HTTP server before enabling SSE

SSE keeps one request open per client. A single-threaded `HTTPServer` would let
one `/events` connection block every login, message, and workspace request.
Check the private runtime file before deploying:

```bash
python3 --version  # must be 3.8+
python3 - <<'PY'
import sqlite3
print(sqlite3.sqlite_version)  # must be 3.25+
PY
grep -nE 'ThreadingHTTPServer|ThreadingMixIn|HTTPServer' /opt/samwoo-auth/auth-server.py
```

The server constructor must use `ThreadingHTTPServer`, or a server class whose
MRO includes `ThreadingMixIn`. If it currently uses `HTTPServer`, change it
before adding the `/events` route:

```python
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

server = ThreadingHTTPServer((host, port), Handler)
server.serve_forever()
```

For a custom server class, the equivalent standard-library form is:

```python
from http.server import HTTPServer
from socketserver import ThreadingMixIn

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
```

### SSE integration edits for `auth-server.py`

Deploy `profile_event_stream.py` beside the existing workspace modules, then
apply these additions without changing any existing POST route:

```python
# 1. imports
import profile_event_stream
```

```python
# 2. at the start of do_GET
if profile_event_stream.is_event_stream_path(self.path):
    profile_event_stream.handle_event_stream(self)
    return
```

```bash
# 3. verify send/read hooks are present in the deployed messaging module
grep -n 'profile_event_stream.publish' /opt/samwoo-auth/profile_messaging.py
```

`send_message` publishes `message` only after its database commit, and
`mark_read` publishes `read` after its monotonic read-cursor transaction. The
existing `/profile-messages/*` and `/workspace-shares/*` polling routes remain
unchanged for older applications.

### Database backup

`backup-workspace-db.sh` uses SQLite's online backup command, keeps daily files
for 14 days, and exits nonzero on failure. Example cron entry:

```cron
0 3 * * * /opt/samwoo-auth/backup-workspace-db.sh <BACKUP_DIR>
```

Restore by stopping `samwoo-auth`, copying one backup over the configured
workspace database path, setting mode `0600`, and restarting the service.

## Mail extension (secure variant)

Session-scoped IMAP/SMTP mail access for the team bots. Each employee accesses
**only their own mailbox** with the credential they entered at login.

## Files
- `mail_ext.py` — session store, IMAP/SMTP operations, and server-side attachment transfer.
- `mail_endpoints.py` — glue that turns `/mail/*` requests into `mail_ext` calls.
- `workspace_sharing.py` — shared workspace write authorization and revision tracking.
- `nextcloud_workspace_storage.py` — direct Nextcloud WebDAV file storage.

Deploy these modules next to `/opt/samwoo-auth/auth-server.py`.

## Security properties (why this differs from the original draft)
The earlier plan stored the **plaintext groupware password** server-side and
piped it into the AI bot's chat context. This variant closes both holes:

1. **Credential never reaches the model.** The bot receives only an opaque
   session token (as the `$MAILTOKEN` env var, never in the prompt/transcript)
   and calls `/mail/*` with `Authorization: Bearer $MAILTOKEN`. The server maps
   the token → credential and does the IMAP/SMTP itself.
2. **Never persisted, never logged.** The secret lives only in process memory,
   in a session with an 8h TTL, dropped on logout/restart. Install
   `cryptography` to also hold it encrypted at rest in memory.
3. **Scoped to the owner.** Endpoints derive the username from the token; a
   leaked token can't read someone else's mail or spoof the `From` address.
4. **Send guardrails.** Recipient count and body size are capped.
5. **Credential-agnostic.** Pass an app-specific password or OAuth (XOAUTH2)
   token to `new_session` instead of the login password when the groupware
   supports it — no code change needed downstream. Prefer that over the primary
   password once available.

> Also add an explicit in-app consent notice ("메일을 읽고 보내기 위해 로그인
> 자격증명이 세션 동안 서버에 보관됩니다") before enabling mail — see the app PR.

## Three edits to `auth-server.py`

```python
# 1. near the top
import mail_ext, mail_endpoints
```

```python
# 2. in the login handler, AFTER smtp_verify succeeds.
#    Make smtp_verify RETURN the verified username (was: return True).
working_user = smtp_verify(login, password)      # -> str on success, None/"" on fail
if working_user:
    token = mail_ext.new_session(working_user, password)
    response["token"] = token                     # app stores this as SamwooAuth.token
```

```python
# 3. in do_POST, route the mail paths (read body as JSON first)
if mail_endpoints.is_mail_path(self.path):
    length = int(self.headers.get("Content-Length", 0) or 0)
    raw = self.rfile.read(length) if length else b"{}"
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = {}
    status, payload = mail_endpoints.handle_mail(
        self.path, self.headers.get("Authorization"), body
    )
    data = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(data)))
    self.end_headers()
    self.wfile.write(data)
    return
```

## Config (env, optional)
`SAMWOO_IMAP_HOST` `SAMWOO_IMAP_PORT` `SAMWOO_SMTP_HOST` `SAMWOO_SMTP_PORT`
`SAMWOO_MAIL_TTL` (sec, default 28800) `SAMWOO_MAIL_MAX_RCPT` `SAMWOO_MAIL_MAX_BODY`.
Mail host and port defaults are deployment-specific. Keep production values in the private
operations runbook or service environment rather than this public repository.

## Deploy
```bash
scp mail_ext.py mail_endpoints.py workspace_sharing.py <DEPLOY_USER>@<VPS_HOST>:/opt/samwoo-auth/
ssh <DEPLOY_USER>@<VPS_HOST> 'pip3 install cryptography; \
  # apply the 3 edits above to auth-server.py, then:
  systemctl restart samwoo-auth && journalctl -u samwoo-auth -n 20 --no-pager'
```

After copying the changed modules, restarting `samwoo-auth` is sufficient for the existing mail router to expose the attachment routes.

## Bot skill note
`/opt/data/skills/communication/samwoo-mail/SKILL.md` should curl with the env
token, e.g.:
```
curl -sS -H "Authorization: Bearer $MAILTOKEN" -H 'Content-Type: application/json' \
  -d '{"limit":10}' http://<TAILNET_AUTH_HOST>:8823/mail/list
```
`$MAILTOKEN` is exported into the bot's shell by the app relay; the value is
never printed, so the model reads mail without ever seeing the credential.
