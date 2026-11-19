// The reference rater: Glicko-2 over every audited rated game on the relay, published as one
// addressable assertion per player (NIP-85's kind 30382 with chess tags). Anyone can rerun it.
import { KIND, TOPIC } from "../src/game/events.ts";
import { PROVISIONAL_RD, ratings } from "../src/game/glicko.ts";
import { connect, finishedGames, nowSec, short } from "./node.ts";

const dry = process.argv.includes("--dry");
const net = connect("rater");
const { verdicts, bots } = await finishedGames(net);
console.log(`rater ${net.signer.pubkey}, ${verdicts.filter((v) => v.rated).length} rated games\n`);
for (const [player, speeds] of ratings(verdicts, (pubkey) => bots.has(pubkey))) {
  const rows = Object.entries(speeds);
  for (const [speed, { r, rd, games }] of rows)
    console.log(
      `${short(player)}${bots.has(player) ? " BOT" : "    "}  ${speed.padEnd(14)} ${Math.round(r)}${rd >= PROVISIONAL_RD ? "?" : " "}  ±${Math.round(rd)}  ${games} games`,
    );
  if (dry) continue;
  await net.publish({
    kind: KIND.rating,
    created_at: nowSec(),
    content: "",
    tags: [
      ["d", player],
      ["p", player],
      ["t", TOPIC],
      ...rows.flatMap(([speed, { r, rd, games }]) => [
        [`rating:${speed}`, String(Math.round(r))],
        [`rd:${speed}`, String(Math.round(rd))],
        [`games:${speed}`, String(games)],
      ]),
    ],
  });
}
console.log(dry ? "\ndry run, nothing published" : "\nassertions published");
net.close();
