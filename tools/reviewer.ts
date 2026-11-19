// The first automated reviewer: compares each player's moves with a shallow Stockfish search and
// publishes a NIP-32 label that carries the numbers.
// Without flags it is the free pass over every finished game on the relay. `--dry` prints without
// publishing, `--include-bots` also reviews keys that declare themselves bots.
// `--serve` stays up and sells the same review on request, deeper and at once: it reviews a game
// when a valid zap receipt of at least NOCHESS_REVIEW_PRICE (sats) names it, and its labels name
// that receipt.
import { Chess } from "chess.js";
import { Engine } from "../packages/core/src/engine/uci.ts";
import { audit, type Verdict } from "../packages/core/src/game/archive.ts";
import { KIND, tagValue, TOPIC } from "../packages/core/src/game/events.ts";
import { labelFor, type Reviewed, summarise, THRESHOLD } from "../packages/core/src/game/review.ts";
import { owed } from "../packages/core/src/zap/fee.ts";
import { readZap, type Zap } from "../packages/core/src/zap/zap.ts";
import {
  connect,
  ENGINE_NAME,
  enginePipe,
  finishedGames,
  nowSec,
  RELAY,
  servicePoint,
  short,
} from "./node.ts";

const NAMESPACE = "nochess/fairplay";
const DEPTH = Number(process.env.NOCHESS_REVIEW_DEPTH ?? 10);
const PAID_DEPTH = Number(process.env.NOCHESS_REVIEW_PAID_DEPTH ?? 14);
const PRICE = Number(process.env.NOCHESS_REVIEW_PRICE ?? 50) * 1000;
const KEEP_OPEN = 86_400;
const dry = process.argv.includes("--dry");

const net = connect("reviewer");
const me = net.signer.pubkey;
const engine = new Engine(enginePipe());

/** Reviews both players of a game, leaving out `skip`; `paidBy` is the receipt that asked for it. */
async function review(
  verdict: Verdict,
  skip: { has(pubkey: string): boolean },
  depth: number,
  paidBy?: string,
) {
  const chess = new Chess();
  const seen: { best: string; cp: number; forced: boolean; played: string }[] = [];
  for (const san of [...verdict.sans, null]) {
    const forced = chess.moves().length === 1;
    const found = chess.isGameOver()
      ? { best: "", cp: chess.isCheckmate() ? -1000 : 0 }
      : await engine.go(chess.fen(), `depth ${depth}`);
    const made = san ? chess.move(san) : null;
    seen.push({ ...found, forced, played: made ? made.lan : "" });
  }
  for (const seat of [0, 1]) {
    const player = verdict.players[seat];
    const id = `${verdict.addr.slice(-8)}  ${short(player)}`;
    if (skip.has(player)) {
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
        ...(paidBy ? [["e", paidBy]] : []),
      ],
      content: JSON.stringify({
        engine: ENGINE_NAME,
        depth,
        ...summary,
        threshold: THRESHOLD,
        moves: moves.map((move) => [move.played, move.best, move.loss]),
      }),
    });
  }
}

console.log(`reviewer ${me}\n${ENGINE_NAME}\n`);
console.log("game      player    positions  match  acpl   label");
if (process.argv.includes("--serve")) {
  const lud16 = process.env.NOCHESS_REVIEW_LUD16 ?? "";
  const point = await servicePoint(lud16);
  await net.publish({
    kind: KIND.profile,
    created_at: nowSec(),
    tags: [["t", TOPIC]],
    content: JSON.stringify({
      name: process.env.NOCHESS_REVIEW_NAME ?? "Nochess reviewer",
      about: `Fair-play review on request: ${ENGINE_NAME}, depth ${PAID_DEPTH}.`,
      lud16,
      nochess: { role: "review", price_msat: PRICE },
    }),
  });
  const zaps = new Map<string, Zap>();
  const answered = new Set<string>();
  let ledger = false;
  let work: Promise<unknown> = Promise.resolve();
  /** Reviews what is owed and finished; a request whose game has no archive yet waits a day. */
  async function serve() {
    const since = nowSec() - KEEP_OPEN;
    for (const zap of owed([...zaps.values()], answered, PRICE)) {
      if (zap.at < since) continue;
      const notes = await net.fetch([{ kinds: [KIND.archive], "#a": [zap.addr!] }]);
      const verdict = notes.length ? audit(notes) : null;
      if (!verdict || verdict.result === "*") continue;
      answered.add(zap.id);
      await review(verdict, new Set(), PAID_DEPTH, zap.id);
    }
  }
  const soon = () => ledger && (work = work.then(serve).catch(console.error));
  net.subscribe(
    [
      { kinds: [KIND.zap], "#p": [me] },
      { kinds: [KIND.label], authors: [me], "#L": [NAMESPACE] },
    ],
    (event) => {
      const zap = event.kind === KIND.zap ? readZap(event, point.nostrPubkey) : null;
      if (zap?.to === me) zaps.set(zap.id, zap);
      const paidBy = event.pubkey === me && tagValue(event, "e");
      if (paidBy) answered.add(paidBy);
      soon();
    },
    () => {
      ledger = true;
      soon();
    },
  );
  setInterval(soon, 5000);
  console.log(`serving reviews for ${PRICE / 1000} sats on ${RELAY}`);
} else {
  const { verdicts, bots } = await finishedGames(net);
  const mine = await net.fetch([
    { kinds: [KIND.label], authors: [me], "#L": [NAMESPACE], limit: 5000 },
  ]);
  const done = new Set(mine.map((label) => tagValue(label, "a")));
  for (const verdict of verdicts)
    if (verdict.result !== "*" && !done.has(verdict.addr))
      await review(verdict, process.argv.includes("--include-bots") ? new Set() : bots, DEPTH);
  console.log(dry ? "\ndry run, nothing published" : "\nlabels published");
  engine.close();
  net.close();
}
