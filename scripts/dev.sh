#!/bin/sh
# One command for local play: the relay on ws://127.0.0.1:7778, the bot account and the Vite dev server.
set -eu
scripts/relay.sh relay.dev.json &
relay=$!
LUFT_RELAY=ws://127.0.0.1:7778 node tools/bot.ts &
bot=$!
trap 'kill $relay $bot 2>/dev/null' EXIT INT TERM
pnpm exec vite --port 5174 --strictPort "$@"
