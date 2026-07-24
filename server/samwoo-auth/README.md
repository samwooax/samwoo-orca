# samwoo-auth — mail extension (secure variant)

Session-scoped IMAP/SMTP mail access for the team bots. Each employee accesses
**only their own mailbox** with the credential they entered at login.

## Files
- `mail_ext.py` — session store + IMAP(993)/SMTP(587) operations.
- `mail_endpoints.py` — glue that turns `/mail/*` requests into `mail_ext` calls.

Deploy both next to `/opt/samwoo-auth/auth-server.py`.

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
Defaults target `play.samwooeleco.com` 993/587.

## Deploy
```bash
scp mail_ext.py mail_endpoints.py root@187.127.120.88:/opt/samwoo-auth/
ssh root@187.127.120.88 'pip3 install cryptography; \
  # apply the 3 edits above to auth-server.py, then:
  systemctl restart samwoo-auth && journalctl -u samwoo-auth -n 20 --no-pager'
```

## Bot skill note
`/opt/data/skills/communication/samwoo-mail/SKILL.md` should curl with the env
token, e.g.:
```
curl -sS -H "Authorization: Bearer $MAILTOKEN" -H 'Content-Type: application/json' \
  -d '{"limit":10}' http://100.116.18.119:8823/mail/list
```
`$MAILTOKEN` is exported into the bot's shell by the app relay; the value is
never printed, so the model reads mail without ever seeing the credential.
