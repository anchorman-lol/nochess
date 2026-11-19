#!/bin/sh
# Runs the anchorman relay with the given config. The binary is built once from
# $ANCHORMAN_RELAY (default ~/work/anchorman-relay) and kept in .relay-bin/ of
# the main checkout, so worktrees share it.
set -eu
config=${1:-relay.dev.json}
root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
bin=${LUFT_RELAY_BIN:-$root/.relay-bin/relay}
if [ ! -x "$bin" ]; then
  src=${ANCHORMAN_RELAY:-$HOME/work/anchorman-relay}
  target=$root/.relay-target
  (cd "$src" && CARGO_TARGET_DIR=$target cargo build --quiet --release -p relay-distribution)
  mkdir -p "$(dirname "$bin")"
  cp "$target/release/relay" "$bin"
  rm -rf "$target"
fi
mkdir -p .relay-data
exec "$bin" "$config"
