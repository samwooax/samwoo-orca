# SAMWOO-ORCA upstream update process

SAMWOO-ORCA watches the latest stable release from `stablyai/orca` every day at
09:00 Asia/Seoul. A new release opens one GitHub issue labeled
`upstream-update`; prereleases and individual commits do not trigger a notice.

If the repository secret `SLACK_WEBHOOK_URL` exists, the same issue is also
posted to Slack. GitHub Issues remain the durable notification and review log.

## Review and release gate

1. Review the release notes and compare link in the generated issue.
2. Fetch the upstream tag and integrate it on a dedicated branch. Resolve
   conflicts without dropping SAMWOO authentication, updater, installer, or
   Hermes team-chat changes.
3. Update `.samwoo/upstream-release.json` to the integrated tag in that branch.
4. Run the full SAMWOO validation suite and review the pull request.
5. After merge, bump the SAMWOO stable package version above the integrated upstream version and manually run
   `Prepare SAMWOO-ORCA Windows release`.
6. Test the signed installer from the draft release. Publish the draft only
   after administrator approval.

Installed clients only see a published, non-draft release with a newer semantic
version. An upstream notice, commit, CI build, or draft release never deploys by
itself.
