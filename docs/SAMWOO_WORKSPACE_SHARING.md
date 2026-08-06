# SAMWOO workspace sharing

SAMWOO-ORCA shares a **Git workspace definition**, not a laptop folder. The auth
service exposes active definitions only to users whose server-resolved Hermes
profile matches the owner's profile. Each recipient clones the repository into
their own local folder, so no inbound connection to another employee laptop is
created.

## User behavior

- Open **Workspace board → Team shared workspaces**.
- Owners select a Git-backed project, set a separately editable shared name and
  choose catalog-only, local-clone, or contribute-with-Git-access behavior.
- Recipients may set a local alias. It is stored only on that laptop and does not
  rename the central entry.
- Profile members can add comments to a shared workspace and mark each comment
  complete. The comment records who created it and who last completed it.
- An expanded comment thread refreshes every 15 seconds and also provides a
  manual refresh action.
- Existing workspace cards retain Orca's normal rename behavior (double-click or
  the metadata action), independent of the Git repository name.
- Revocation immediately removes the definition from the central list. It cannot
  delete an already cloned folder or replace repository-provider access control.

The contribution label does not grant Git write access. GitHub, GitLab, or the
configured Git provider remains authoritative for clone and push permissions.

Comments and their completion status are stored in the workspace catalog. No
local path, password, access token, or SSH private key is stored centrally.
GitHub, GitLab and other Git remotes are accepted through generic HTTPS, SSH URL,
or SCP-style Git addresses.

## Auth-service deployment

Copy `workspace_sharing.py` and `workspace_share_endpoints.py` from
`server/samwoo-auth/` beside `auth-server.py`. Then make these integrations:

```python
import workspace_sharing, workspace_share_endpoints

# After login has resolved the actual Hermes profile and issued token:
workspace_sharing.bind_session(token, working_user, resolved_profile)

# In do_POST, parse JSON and route exactly like mail_endpoints:
if workspace_share_endpoints.is_workspace_share_path(self.path):
    status, payload = workspace_share_endpoints.handle_workspace_share(
        self.path, self.headers.get("Authorization"), body
    )
    # send payload as JSON with the returned status
```

Set `SAMWOO_WORKSPACE_DB` to move the SQLite catalog from its default
`/opt/samwoo-auth/workspace-shares.db`. The module creates the file as mode 0600.
Restart `samwoo-auth` after integrating the routes.

Run the server module tests with:

```bash
cd server/samwoo-auth
python3 -m unittest test_workspace_sharing.py
```
