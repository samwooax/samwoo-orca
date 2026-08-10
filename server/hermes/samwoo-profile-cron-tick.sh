#!/bin/sh
set -u

profile_root=/opt/data/profiles
runtime_dir=/opt/data/cron
heartbeat_file=$runtime_dir/samwoo-profile-ticker-heartbeat
error_log=$runtime_dir/samwoo-profile-ticker-errors.log

mkdir -p "$runtime_dir"
date +%s > "$heartbeat_file"

pids=""
for profile_home in "$profile_root"/*; do
  [ -d "$profile_home" ] || continue
  [ -f "$profile_home/config.yaml" ] || continue
  [ "$(basename "$profile_home")" = oliver ] && continue
  (
    output=$(HERMES_HOME="$profile_home" /usr/local/bin/hermes cron tick --accept-hooks 2>&1)
    status=$?
    if [ "$status" -ne 0 ]; then
      printf '%s profile=%s tick_failed %s\n' \
        "$(date -u +%FT%TZ)" "${profile_home##*/}" "$output" >> "$error_log"
    fi
    exit "$status"
  ) &
  pids="$pids $!"
done

failed=0
for pid in $pids; do
  wait "$pid" || failed=1
done

date +%s > "$heartbeat_file"
exit "$failed"
