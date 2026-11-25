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
