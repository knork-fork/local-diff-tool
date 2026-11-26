#!/usr/bin/env bash
# Installs the `review` command as a symlink in ~/.local/bin pointing at bin/review in this repo.
# Start the app separately with `docker compose up -d`. Safe to re-run.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="$APP_DIR/bin/review"
BIN_DIR="$HOME/.local/bin"
LINK="$BIN_DIR/review"

[ -f "$SRC" ] || { echo "setup: $SRC not found" >&2; exit 1; }
chmod +x "$SRC"
mkdir -p "$BIN_DIR"

if [ -e "$LINK" ] || [ -L "$LINK" ]; then
  if [ -L "$LINK" ]; then
    ln -sfn "$SRC" "$LINK"
  else
    echo "setup: $LINK exists and is not a symlink; refusing to overwrite it" >&2
    exit 1
  fi
else
  ln -s "$SRC" "$LINK"
fi
echo "Installed: $LINK -> $SRC"

case ":$PATH:" in
  *":$BIN_DIR:"*) echo "$BIN_DIR is already on your PATH. Try: review" ;;
  *) echo "Add $BIN_DIR to your PATH, e.g.:"
     echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc" ;;
esac

# Install the start-review agent skill (symlink) into a Claude config dir's skills folder.
SKILL_SRC="$APP_DIR/skills/start-review"
if [ -d "$SKILL_SRC" ]; then
  DEFAULT_CFG="$HOME/.claude"
  CFG=""
  if [ -t 0 ]; then
    read -r -p "Install the start-review skill to which directory? [$DEFAULT_CFG] " CFG || CFG=""
  fi
  CFG="${CFG:-$DEFAULT_CFG}"
  CFG="${CFG/#\~/$HOME}"
  SKILL_LINK="$CFG/skills/start-review"
  mkdir -p "$CFG/skills"
  if [ -L "$SKILL_LINK" ] || [ ! -e "$SKILL_LINK" ]; then
    ln -sfn "$SKILL_SRC" "$SKILL_LINK"
    echo "Installed skill: $SKILL_LINK -> $SKILL_SRC"
  else
    echo "setup: $SKILL_LINK exists and is not a symlink; skipping skill install" >&2
  fi
fi
