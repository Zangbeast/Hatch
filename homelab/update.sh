#!/usr/bin/env bash
# Auto-updater for the homelab deployment.
#
# Checks GitHub for new code and, only if something actually changed, rebuilds
# and restarts the app. Safe to run every few minutes from cron or a systemd
# timer — when there's nothing new it does almost nothing.
set -euo pipefail

# Move to the repo root (this script lives in homelab/).
cd "$(dirname "$0")/.."

before="$(git rev-parse HEAD)"
git pull --ff-only
after="$(git rev-parse HEAD)"

if [ "$before" != "$after" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S'): update $before -> $after — rebuilding"
  docker compose up -d --build
  echo "$(date '+%Y-%m-%d %H:%M:%S'): done"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S'): already up to date"
fi
