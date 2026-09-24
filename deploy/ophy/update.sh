#!/usr/bin/env bash
# Pull the latest code on ophy and restart the game server. Run from anywhere:
#   ssh ophy '~/services/royale/deploy/ophy/update.sh'
# Restarting royale.service ends any live match; the tunnel keeps its origin (it only restarts if it dies).
set -euo pipefail
cd "$(dirname "$0")/../.."
git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
sudo install -m 644 deploy/ophy/royale.service deploy/ophy/royale-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart royale.service
sudo systemctl enable --now royale-tunnel.service
systemctl --no-pager --lines=0 status royale.service royale-tunnel.service | grep -E '●|Active'
