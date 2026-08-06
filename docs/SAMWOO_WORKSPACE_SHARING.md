# SAMWOO workspace sharing

SAMWOO-ORCA uploads project files to a profile-isolated Nextcloud WebDAV
workspace. Recipients do not need GitHub accounts, and Git remotes are not used
for workspace sharing.

The auth service derives the profile from the logged-in session. A client cannot
select another profile, and users outside the profile cannot list, download, or
change its workspace entries. Every recipient works in a local folder; sharing
does not open an inbound connection to another employee laptop.

## User behavior

- Open **Workspace board → Team shared workspaces**.
- Select a local project, an editable shared name, and a permission.
- **List only** exposes metadata and comments but not files.
- **Local copy** permits file download. **Can contribute** also permits upload.
  The owner can always upload while the share remains active.
- **Get changes** preserves locally modified files when the corresponding cloud
  file has also changed and reports them as conflicts instead of overwriting.
- File removal is synchronized only after it appears in the preview and the user
  confirms it. Revoking a share hides its catalog entry but does not delete any
  employee's local copy.
- `.git`, `node_modules`, credential directories (`.ssh`, `.aws`, `.gnupg`),
  common secret files (`.env`, private-key formats, package credential files),
  and symbolic links are excluded from company-cloud uploads. Example/template
  `.env` files remain shareable. Individual files are limited to 16 MiB and a
  workspace to 5,000 files. SSH/runtime-host projects are not offered for
  company-cloud upload; they must first be copied locally.
- Profile members can comment and mark comments complete. The latest 50 comments
  load first, with bounded pagination for older comments.

Local aliases, local folder paths, passwords, tokens, and SSH keys are never
stored in the central workspace catalog. Sync manifests containing only file
hashes and ETags live under Orca's local application-data directory.
Workspace login sessions survive auth-service restarts using SHA-256 token
hashes in the restricted SQLite catalog; raw bearer tokens are never written.

## Nextcloud storage model

The auth service uses one restricted Nextcloud service account and stores files
under:

```text
SAMWOO-Workspaces/<server-resolved-profile>/<share-id>/
```

The service credential stays on the auth server and is never returned to Orca.
Configure these environment variables on `samwoo-auth`:

```text
SAMWOO_NEXTCLOUD_URL=https://cloud.example.com
SAMWOO_NEXTCLOUD_USERNAME=orca-workspaces
SAMWOO_NEXTCLOUD_APP_PASSWORD=<app-password>
SAMWOO_NEXTCLOUD_WORKSPACE_ROOT=SAMWOO-Workspaces   # optional
SAMWOO_NEXTCLOUD_MAX_FILE_BYTES=16777216            # optional
```

Give the service account access only to its workspace root. Do not use a
Nextcloud administrator account.

## Auth-service deployment

`install_workspace_sharing.py` installs or upgrades these modules beside
`/opt/samwoo-auth/auth-server.py`:

- `nextcloud_workspace_storage.py`
- `workspace_sharing.py`
- `workspace_share_endpoints.py`

The installer also binds newly issued login tokens to the server-resolved
profile and adds the `/workspace-shares/*` routes with a 24 MiB request cap.
Set `SAMWOO_WORKSPACE_DB` to move the SQLite catalog from its default
`/opt/samwoo-auth/workspace-shares.db`. Restart `samwoo-auth` after deployment.

Run the server tests with:

```bash
cd server/samwoo-auth
python3 -m unittest \
  test_workspace_sharing.py \
  test_workspace_comments.py \
  test_nextcloud_workspace_storage.py
```
