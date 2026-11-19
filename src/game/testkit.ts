import { Chess } from "chess.js";
import {
  type Action,
  address,
  build,
  type GameEvent,
  hashHex,
  hostIsWhite,
  type Template,
  type Terms,
} from "./events.ts";

export const HOST = "a".repeat(64);
export const GUEST = "b".repeat(64);
/** Session keys, White's first: the kit always seats the host as White. */
export const KEYS = ["c".repeat(64), "d".repeat(64)];
export const GAME = "g1";
export const ADDR = address(HOST, GAME);
export const BLITZ: Terms = { tc: "300+3", rated: true };
export const START = 100;

let serial = 0;
export const sign = (pubkey: string, template: Template): GameEvent => ({
  ...template,
  pubkey,
  id: String(++serial).padStart(64, "0"),
});

/** A seek and a join that fits it. */
export function seek(terms = BLITZ, salt = "salt", joinTerms = terms): GameEvent[] {
  return [
    sign(HOST, build.open(GAME, terms, KEYS[0], hashHex(salt), 90)),
    sign(GUEST, build.join(ADDR, HOST, joinTerms, KEYS[1], hashHex(salt), 95)),
  ];
}

/** A game the host has started, with the host as White. */
export function started(terms = BLITZ): GameEvent[] {
  const join = sign(GUEST, build.join(ADDR, HOST, terms, KEYS[1], "", 95));
  let n = 0;
  while (!hostIsWhite(`s${n}`, join.id)) n++;
  join.tags.find((tag) => tag[0] === "seed")![1] = hashHex(`s${n}`);
  return [join, sign(HOST, build.playing(GAME, terms, KEYS[0], `s${n}`, join, START))];
}

/** Appends moves, each `step` seconds after the one before, or at the times given. */
export function play(events: GameEvent[], sans: string[], step: number | number[] = 5) {
  const chess = new Chess();
  const moves = events.filter((event) => event.kind === 1641);
  for (const move of moves) chess.move(move.content);
  let prev = moves.at(-1)?.id ?? events[0].id;
  let at = moves.at(-1)?.created_at ?? START;
  const out = [...events];
  sans.forEach((san, i) => {
    const ply = moves.length + i + 1;
    at = Array.isArray(step) ? step[i] : at + step;
    const made = chess.move(san);
    const move = sign(KEYS[(ply - 1) % 2], build.move(ADDR, ply, prev, made.san, made.after, at));
    prev = move.id;
    out.push(move);
  });
  return out;
}

export const act = (seat: number, ply: number, action: Action, at: number) =>
  sign(KEYS[seat], build.action(ADDR, ply, action, at));
