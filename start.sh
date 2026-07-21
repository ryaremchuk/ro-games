#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Use Node from .nvmrc if nvm is available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || nvm install
fi

# Install deps on first run (or after they were removed)
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# Serve on all network interfaces (--host binds 0.0.0.0), so the app is
# reachable both at http://localhost:5173/ro-games/ on this machine and at
# http://<this-machine-ip>:5173/ro-games/ from other devices on the LAN
# (e.g. the iPad). Vite prints the exact Local + Network URLs on startup.
npm run dev -- --host
