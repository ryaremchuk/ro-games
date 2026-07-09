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

npm run dev
