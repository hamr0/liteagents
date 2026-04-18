#!/usr/bin/env bash
# Live Canvas channel — one-time setup helper.
#
# Run this once from a shell, then follow the printed manual steps in Claude Code.
# Safe to re-run; `npm install` is idempotent.

set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$HERE/plugins/live-canvas-channel"
MARKETPLACE_PATH="$HERE"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }

if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found. Install Node >= 18 first: https://nodejs.org"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node >= 18 required (found $(node -v))."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  warn "npm not found. Usually ships with Node."
  exit 1
fi

bold "Installing channel plugin dependencies…"
cd "$PLUGIN_DIR"
npm install --silent
ok "Dependencies installed in $PLUGIN_DIR"

echo
bold "Next steps (run these inside Claude Code):"
cat <<EOF

  1. Register this marketplace:
       /plugin marketplace add $MARKETPLACE_PATH

  2. Install the plugin from it:
       /plugin install live-canvas-channel@live-canvas-marketplace

  3. Close this session and start a new one with the dev-channels flag:
       claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace

  4. Confirm the one-time safety prompt. Channel is now listening on
     port 8788 for overlay feedback events.

  5. Run /live-canvas to generate variants in any project. The skill will
     auto-detect the channel and use Live mode.

Tip — save yourself typing with a shell alias in ~/.zshrc or ~/.bashrc:
  alias claude-live='claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace'

EOF

ok "Setup complete."
