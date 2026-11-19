// The reference rater: Glicko-2 over every audited rated game on the relay, published as one
// addressable assertion per player (NIP-85's kind 30382 with chess tags) that names the games it
// covers, so anyone can rerun it. Each assertion also carries the player's reliability: for a bot
// how it answered its challenges, for everyone how many games it abandoned. `--dry` prints only, `--watch` rates again every
// NOCHESS_RATE_EVERY seconds (default 30), `--pubkey` prints the rater's key for clients to trust.
import { getPublicKey } from "nostr-tools/pure";
import { assertion, coverOf } from "../packages/core/src/game/assertion.ts";
import { KIND, TOPIC } from "../packages/core/src/game/events.ts";
import { PROVISIONAL_RD, ratings } from "../packages/core/src/game/glicko.ts";
import { describeReliability, reliability } from "../packages/core/src/game/reliability.ts";
import { payPoint } from "../packages/core/src/zap/lnurl.ts";
import { readZap } from "../packages/core/src/zap/zap.ts";
import { connect, finishedGames, nowSec, secretOf, short } from "./node.ts";

if (process.argv.includes("--pubkey")) {
  console.log(getPublicKey(secretOf("rater")));
  process.exit(0);
}
const dry = process.argv.includes("--dry");
const watch = process.argv.includes("--watch");
const net = connect("rater");
const published = new Map<string, string>();

/** The public events a bot's record rests on: challenges, its joins and declines, and checked zaps to it. */
async function botEvents(bots: Awaited<ReturnType<typeof finishedGames>>["bots"]) {
  const authors = [...bots.keys()];
  if (!authors.length) return { lobbies: [], joins: [], zaps: [] };
  const [lobbies, joins, receipts, points] = await Promise.all([
    net.fetch([{ kinds: [KIND.game], "#t": [TOPIC], "#p": authors, limit: 5000 }]),
    net.fetch([{ kinds: [KIND.join], authors, limit: 5000 }]),
    net.fetch([{ kinds: [KIND.zap], "#p": authors, limit: 5000 }]),
    Promise.all(authors.map((bot) => payPoint(bots.get(bot)!).catch(() => null))),
  ]);
  const zaps = receipts.flatMap((receipt) => {
    const point = points[authors.indexOf(receipt.tags.find((tag) => tag[0] === "p")?.[1] ?? "")];
    return (point && readZap(receipt, point.nostrPubkey)) || [];
  });
  return { lobbies, joins, zaps };
}

async function run() {
  const { verdicts, bots } = await finishedGames(net);
  const sources = { ...(await botEvents(bots)), verdicts };
  const cover = coverOf(verdicts);
  const table = ratings(verdicts, (pubkey) => bots.has(pubkey));
  const players = new Set([...table.keys(), ...bots.keys()]);
  console.log(`rater ${net.signer.pubkey}, ${cover.count} rated games\n`);
  for (const player of players) {
    const speeds = table.get(player) ?? {};
    const record = reliability(player, sources, nowSec());
    const { tags } = assertion(player, speeds, cover, 0, record);
    if (published.get(player) === JSON.stringify(tags)) continue;
    for (const [speed, { r, rd, games }] of Object.entries(speeds))
      console.log(
        `${short(player)}${bots.has(player) ? " BOT" : "    "}  ${speed.padEnd(14)} ${Math.round(r)}${rd >= PROVISIONAL_RD ? "?" : " "}  ±${Math.round(rd)}  ${games} games`,
      );
    const said = describeReliability(record, bots.has(player));
    if (said) console.log(`${short(player)}  ${said}`);
    if (dry) continue;
    await net.publish(assertion(player, speeds, cover, nowSec(), record));
    published.set(player, JSON.stringify(tags));
  }
  console.log(dry ? "\ndry run, nothing published" : "\nassertions published");
}

await run();
if (watch)
  setInterval(
    () => void run().catch(console.error),
    Number(process.env.NOCHESS_RATE_EVERY ?? 30) * 1000,
  );
else net.close();
