// The first automated reviewer: reads finished games from the relay, compares each player's moves
// with a shallow Stockfish search and publishes a NIP-32 label that carries the numbers.
// `--dry` prints without publishing, `--include-bots` also reviews keys that declare themselves bots.
import { Chess } from "chess.js";
import { Engine, ENGINE } from "../src/engine/uci.ts";
import { KIND } from "../src/game/events.ts";
import { labelFor, type Reviewed, summarise, THRESHOLD } from "../src/game/review.ts";
import { connect, enginePipe, finishedGames, nowSec, short } from "./node.ts";

const NAMESPACE = "luft/fairplay";
const DEPTH = Number(process.env.LUFT_REVIEW_DEPTH ?? 10);
const dry = process.argv.includes("--dry");
const includeBots = process.argv.includes("--include-bots");

const net = connect("reviewer");
const engine = new Engine(enginePipe());
const { verdicts, bots } = await finishedGames(net);
const mine = await net.fetch([
  { kinds: [KIND.label], authors: [net.signer.pubkey], "#L": [NAMESPACE], limit: 5000 },
]);
const done = new Set(mine.map((label) => `${label.tags.find((t) => t[0] === "a")?.[1]}`));

console.log(`reviewer ${net.signer.pubkey}\n${ENGINE}, depth ${DEPTH}\n`);
console.log("game      player    positions  match  acpl   label");
for (const verdict of verdicts) {
  if (verdict.result === "*" || done.has(verdict.addr)) continue;
  const chess = new Chess();
  const seen: { best: string; cp: number; forced: boolean; played: string }[] = [];
  for (const san of [...verdict.sans, null]) {
    const forced = chess.moves().length === 1;
    const found = chess.isGameOver()
      ? { best: "", cp: chess.isCheckmate() ? -1000 : 0 }
      : await engine.go(chess.fen(), `depth ${DEPTH}`);
    const made = san ? chess.move(san) : null;
    seen.push({ ...found, forced, played: made ? made.lan : "" });
  }
  for (const seat of [0, 1]) {
    const player = verdict.players[seat];
    const id = `${verdict.addr.slice(-8)}  ${short(player)}`;
    if (bots.has(player) && !includeBots) {
      console.log(`${id}  declared bot, not reviewed`);
      continue;
    }
    const moves: Reviewed[] = verdict.sans.flatMap((_, ply) =>
      ply % 2 === seat
        ? {
            played: seen[ply].played,
            best: seen[ply].best,
            before: seen[ply].cp,
            loss: seen[ply].cp + seen[ply + 1].cp,
            forced: seen[ply].forced,
          }
        : [],
    );
    const summary = summarise(moves);
    const label = labelFor(summary);
    console.log(
      `${id}  ${String(summary.positions).padStart(9)}  ${(summary.matchRate * 100).toFixed(0).padStart(4)}%  ${summary.acpl.toFixed(0).padStart(4)}   ${label}`,
    );
    if (dry) continue;
    await net.publish({
      kind: KIND.label,
      created_at: nowSec(),
      tags: [
        ["L", NAMESPACE],
        ["l", label, NAMESPACE],
        ["a", verdict.addr],
        ["p", player],
      ],
      content: JSON.stringify({
        engine: ENGINE,
        depth: DEPTH,
        ...summary,
        threshold: THRESHOLD,
        moves: moves.map((move) => [move.played, move.best, move.loss]),
      }),
    });
  }
}
console.log(dry ? "\ndry run, nothing published" : "\nlabels published");
engine.close();
net.close();
