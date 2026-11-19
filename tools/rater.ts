// The reference rater: Glicko-2 over every audited rated game on the relay, published as one
// addressable assertion per player (NIP-85's kind 30382 with chess tags) that names the games it
// covers, so anyone can rerun it. `--dry` prints only, `--watch` rates again every
// LUFT_RATE_EVERY seconds (default 30), `--pubkey` prints the rater's key for clients to trust.
import { getPublicKey } from "nostr-tools/pure";
import { assertion, coverOf } from "../src/game/assertion.ts";
import { PROVISIONAL_RD, ratings } from "../src/game/glicko.ts";
import { connect, finishedGames, nowSec, secretOf, short } from "./node.ts";

if (process.argv.includes("--pubkey")) {
  console.log(getPublicKey(secretOf("rater")));
  process.exit(0);
}
const dry = process.argv.includes("--dry");
const watch = process.argv.includes("--watch");
const net = connect("rater");
const published = new Map<string, string>();

async function run() {
  const { verdicts, bots } = await finishedGames(net);
  const cover = coverOf(verdicts);
  console.log(`rater ${net.signer.pubkey}, ${cover.count} rated games\n`);
  for (const [player, speeds] of ratings(verdicts, (pubkey) => bots.has(pubkey))) {
    const { tags } = assertion(player, speeds, cover, 0);
    if (published.get(player) === JSON.stringify(tags)) continue;
    for (const [speed, { r, rd, games }] of Object.entries(speeds))
      console.log(
        `${short(player)}${bots.has(player) ? " BOT" : "    "}  ${speed.padEnd(14)} ${Math.round(r)}${rd >= PROVISIONAL_RD ? "?" : " "}  ±${Math.round(rd)}  ${games} games`,
      );
    if (dry) continue;
    await net.publish(assertion(player, speeds, cover, nowSec()));
    published.set(player, JSON.stringify(tags));
  }
  console.log(dry ? "\ndry run, nothing published" : "\nassertions published");
}

await run();
if (watch)
  setInterval(
    () => void run().catch(console.error),
    Number(process.env.LUFT_RATE_EVERY ?? 30) * 1000,
  );
else net.close();
