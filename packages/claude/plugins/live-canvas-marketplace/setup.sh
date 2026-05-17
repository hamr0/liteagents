#!/usr/bin/env bash
# Live Canvas channel — one-time setup.
#
# Copies the marketplace into ~/.claude/plugins/, installs the channel
# plugin's npm deps, and adds a `live-claude` shell function so the user
# can launch a Live-mode session with one word in a new terminal.
#
# Safe to re-run: existing install at ~/.claude/plugins/live-canvas-marketplace/
# is overwritten; the shell function is replaced in place via marker guards.

set -e

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${HOME}/.claude/plugins"
DEST="${DEST_ROOT}/live-canvas-marketplace"
PLUGIN_DIR="${DEST}/plugins/live-canvas-channel"
MARKER_BEGIN="# >>> live-canvas: live-claude function (managed by setup.sh) >>>"
MARKER_END="# <<< live-canvas: live-claude function <<<"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$*"; }

# ---------- prereq checks ----------

if [ "$(id -u)" = "0" ] && [ -n "${SUDO_USER:-}" ]; then
  err "Don't run setup.sh with sudo — it would install into root's home (\$HOME=$HOME)."
  err "Rerun as your normal user: bash $0"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node >= 18: https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node >= 18 required (found $(node -v))."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  err "npm not found. Usually ships with Node."
  exit 1
fi

# ---------- 1. copy marketplace into ~/.claude/plugins ----------

bold "Installing marketplace to ${DEST}…"
mkdir -p "$DEST_ROOT"
# Overwrite any prior install. Small, self-contained tree — safe to wipe.
rm -rf "$DEST"
cp -R "$HERE" "$DEST"
ok "Copied marketplace files."

# ---------- 2. npm install channel plugin deps ----------

bold "Installing channel plugin dependencies…"
cd "$PLUGIN_DIR"
npm install --silent
ok "Dependencies installed in $PLUGIN_DIR"

# ---------- 3. add live-claude function to shell rc files ----------

add_to_rc() {
  local rc="$1"
  [ -e "$rc" ] || return 0

  local tmp
  tmp="$(mktemp)"
  # Strip any prior managed block, preserving the rest of the file verbatim.
  awk -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    !skip   { print }
  ' "$rc" > "$tmp"

  {
    cat "$tmp"
    echo ""
    echo "$MARKER_BEGIN"
    echo "live-claude() {"
    echo "  claude --dangerously-load-development-channels plugin:live-canvas-channel@live-canvas-marketplace \"\$@\""
    echo "}"
    echo "$MARKER_END"
  } > "$rc.live-canvas.tmp"

  mv "$rc.live-canvas.tmp" "$rc"
  rm -f "$tmp"
  ok "Updated $rc"
}

bold "Adding live-claude function to your shell rc files…"
add_to_rc "$HOME/.zshrc"
add_to_rc "$HOME/.bashrc"

# ---------- 4. print remaining manual steps ----------

cat <<EOF

$(bold "Two more steps — run these inside Claude Code:")

  1. Register the marketplace:
       /plugin marketplace add ${DEST}

  2. Install the plugin from it:
       /plugin install live-canvas-channel@live-canvas-marketplace

$(bold "Then daily use:")

  • Open a fresh shell (or: source ~/.zshrc) so live-claude is on PATH.
  • Terminal A — your dev server (e.g. npm run dev).
  • Terminal B — run: live-claude
      (this is just: claude --dangerously-load-development-channels …)
  • Inside that Claude session, run /live-canvas.

You'll be asked Live vs JSON mode each time.

EOF
ok "Setup complete."
