#!/bin/sh
# One command for local play: the relay on ws://127.0.0.1:7778, a mock Lightning provider on
# :7779 (play money), the free bot, a bot and a reviewer that charge, the rater whose
# assertions the app trusts, and the Vite dev server.
set -eu
export LUFT_RELAY=ws://127.0.0.1:7778
zap=127.0.0.1:7779
scripts/relay.sh relay.dev.json &
relay=$!
node tools/zapmock.ts &
mock=$!
LUFT_BOT_LUD16=luftbot@$zap node tools/bot.ts &
bot=$!
LUFT_BOT_ID=probot LUFT_BOT_NAME="Luftbot Pro" LUFT_BOT_PRICE=21 LUFT_BOT_LUD16=luftbotpro@$zap node tools/bot.ts &
pro=$!
LUFT_REVIEW_LUD16=reviewer@$zap node tools/reviewer.ts --serve &
reviewer=$!
node tools/rater.ts --watch >/dev/null &
rater=$!
trap 'kill $relay $mock $bot $pro $reviewer $rater 2>/dev/null' EXIT INT TERM
# The platform's share goes to this address; the key only names it in the zap, nobody signs with it.
VITE_RATERS=$(node tools/rater.ts --pubkey) VITE_DEV_WALLET=http://$zap VITE_PLATFORM_LUD16=luft@$zap \
  VITE_PLATFORM_PUBKEY=193e245d172bfe0b717e47c6008bfb8611d47356c89779b86daafe8b50655ec9 \
  pnpm --filter @luft/web exec vite --port "${LUFT_WEB_PORT:-5174}" --strictPort "$@"
