#!/usr/bin/env bash
# Install the fairfox CLI onto this machine's PATH from a local
# checkout. For devs and the first-admin case where you already
# have the repo cloned. Production users with a pairing token use
# the `curl … /cli/install?token=…` one-liner instead.
#
# What this does:
#   1. Runs the CLI build (dist/fairfox.js).
#   2. Symlinks dist/fairfox.js to ~/.local/bin/fairfox.
#   3. Drops the zsh completion at ~/.zfunc/_fairfox and prints the
#      fpath snippet to add to ~/.zshrc if it isn't already there.
#
# Idempotent: re-running just refreshes the symlink and completion.

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="$REPO_ROOT/packages/cli"
BIN_DIR="$HOME/.local/bin"
COMP_DIR="$HOME/.zfunc"

echo "[install-cli] building fairfox CLI…"
cd "$CLI_DIR"
bun run build

if [ ! -f "$CLI_DIR/dist/fairfox.js" ]; then
  echo "[install-cli] build did not produce dist/fairfox.js" >&2
  exit 1
fi

echo "[install-cli] symlinking $BIN_DIR/fairfox -> $CLI_DIR/dist/fairfox.js"
mkdir -p "$BIN_DIR"
ln -sf "$CLI_DIR/dist/fairfox.js" "$BIN_DIR/fairfox"
chmod +x "$CLI_DIR/dist/fairfox.js"

echo "[install-cli] installing zsh completion"
mkdir -p "$COMP_DIR"
cp "$CLI_DIR/completions/_fairfox" "$COMP_DIR/_fairfox"

cat <<HINT

[install-cli] done.

  ~/.local/bin/fairfox  → $(readlink "$BIN_DIR/fairfox")
  zsh completion        → $COMP_DIR/_fairfox

If \`which fairfox\` prints anything other than the path above,
add this to your ~/.zshrc and restart the shell:

  export PATH="\$HOME/.local/bin:\$PATH"
  fpath=(\$HOME/.zfunc \$fpath)
  autoload -U compinit && compinit

Smoke test:
  fairfox mesh whoami
HINT
