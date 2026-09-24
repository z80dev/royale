#!/usr/bin/env bash
# Pull the latest code on ophy and restart the game server. Run from anywhere:
#   ssh ophy '~/services/royale/deploy/ophy/update.sh'
# Restarting royale.service ends any live match. The tunnel is only restarted when its unit/config changed
# (cloudflared drains connections for a while on restart, so skipping it keeps deploys to a few seconds).
set -euo pipefail
cd "$(dirname "$0")/../.."
before=$(git rev-parse HEAD)
git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
sudo install -m 644 deploy/ophy/royale.service deploy/ophy/royale-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart royale.service
sudo systemctl enable royale-tunnel.service
if ! git diff --quiet "$before" HEAD -- deploy/ophy/tunnel.yml deploy/ophy/royale-tunnel.service; then
  sudo systemctl restart royale-tunnel.service
else
  sudo systemctl start royale-tunnel.service
fi
systemctl --no-pager --lines=0 status royale.service royale-tunnel.service | grep -E '●|Active'
