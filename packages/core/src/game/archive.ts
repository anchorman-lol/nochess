import { Chess } from "chess.js";
import * as nip19 from "nostr-tools/nip19";
import { type Event, getEventHash, verifyEvent } from "nostr-tools/pure";
import {
  build,
  type GameEvent,
  KIND,
  parseTc,
  type Speed,
  speedOf,
  tagValue,
  type Template,
  TOPIC,
} from "./events.ts";
import { type Game, replay, type Result, type Seat } from "./replay.ts";

export type Verdict = {
  addr: string;
  players: [string, string];
  result: Result;
  termination: string;
  tc: string;
  rated: boolean;
  speed: Speed;
  endedAt: number;
  sans: string[];
  /** The seat that didn't make its first move in time. */
  noStart: Seat | null;
};
type Proof = { head: GameEvent[]; sigs: [number, string][]; extra: GameEvent[] };

export function pgn(game: Game, site: string): string {
  const clock = parseTc(game.tc)!;
  const headers = {
    Event: `Nochess ${game.rated ? "rated" : "casual"} ${speedOf(game.tc)} game`,
    Site: site,
    Date: new Date(game.startedAt * 1000).toISOString().slice(0, 10).replaceAll("-", "."),
    Round: "-",
    White: nip19.npubEncode(game.players![0]),
    Black: nip19.npubEncode(game.players![1]),
    Result: game.result!,
    Termination: pgnTermination(game.termination),
    TimeControl: "days" in clock ? `1/${clock.days * 86_400}` : game.tc,
  };
  const moves = game.sans.map((san, i) => (i % 2 ? san : `${i / 2 + 1}. ${san}`));
  return [
    ...Object.entries(headers).map(([name, value]) => `[${name} "${value}"]`),
    "",
    ...wrap([...moves, game.result!]),
    "",
    "",
  ].join("\n");
}

/** PGN's Termination value for how `replay()` says a game ended. */
export const pgnTermination = (termination: string) =>
  ({
    time: "time forfeit",
    equivocation: "rules infraction",
    "no start": "abandoned",
    aborted: "unterminated",
  })[termination] ?? "normal";

/** Movetext lines under 80 columns, as PGN export format asks. */
function wrap(tokens: string[]): string[] {
  const lines = [""];
  for (const token of tokens) {
    const line = lines.at(-1)!;
    if (line && line.length + 1 + token.length >= 80) lines.push(token);
    else lines[lines.length - 1] = line ? `${line} ${token}` : token;
  }
  return lines;
}

/**
 * A NIP-64 note of a finished game that proves itself: the PGN, plus what it takes to rebuild
 * every signed move (its time and signature) and the other events the result rests on.
 */
export function archive(game: Game, site: string, now: number): Template {
  const played = new Set(game.ids);
  const proof: Proof = {
    head: game.proof.slice(0, 2),
    sigs: game.proof.filter((event) => played.has(event.id)).map((e) => [e.created_at, e.sig!]),
    extra: game.proof.slice(2).filter((event) => !played.has(event.id)),
  };
  return {
    kind: KIND.archive,
    created_at: now,
    content: pgn(game, site),
    tags: [
      ["a", game.addr],
      ["p", game.players![0], "", "white"],
      ["p", game.players![1], "", "black"],
      ["t", TOPIC],
      ["result", game.result!],
      ["alt", `Chess game, ${game.result} by ${game.termination}`],
      ["proof", JSON.stringify(proof)],
    ],
  };
}

/** The signed events an archive carries, rebuilt and checked; null if any of it doesn't hold. */
export function prove(note: GameEvent): GameEvent[] | null {
  try {
    const { head, sigs, extra }: Proof = JSON.parse(tagValue(note, "proof") ?? "");
    const [, host, gameId] = (tagValue(note, "a") ?? "").split(":");
    const { sessions, addr, join } = replay(head, host, gameId);
    const chess = new Chess();
    chess.loadPgn(note.content);
    const sans = chess.history();
    if (!sessions || !join || sans.length !== sigs.length) return null;
    chess.reset();
    let prev = join.id;
    const moves = sans.map((san, i) => {
      const [at, sig] = sigs[i];
      const { after } = chess.move(san);
      const move = {
        ...build.move(addr, i + 1, prev, san, after, at),
        pubkey: sessions[i % 2],
        sig,
      };
      prev = getEventHash(move);
      return { ...move, id: prev };
    });
    const events = [...head, ...moves, ...extra];
    return events.every((event) => verifyEvent({ ...event } as Event)) ? events : null;
  } catch {
    return null;
  }
}

/**
 * How a game ended, from every archive published for it. Their proofs are replayed together, so
 * an archive that leaves out later moves loses to one that has them.
 */
export function audit(notes: GameEvent[]): Verdict | null {
  const [, host, gameId] = (tagValue(notes[0], "a") ?? "").split(":");
  const game = replay(
    notes.flatMap((note) => prove(note) ?? []),
    host ?? "",
    gameId ?? "",
  );
  if (game.phase !== "finished") return null;
  return {
    addr: game.addr,
    players: game.players!,
    result: game.result!,
    termination: game.termination,
    tc: game.tc,
    rated: game.rated,
    speed: speedOf(game.tc)!,
    endedAt: game.endedAt,
    sans: game.sans,
    noStart: game.noStart,
  };
}

/** Archives grouped by game and audited, newest game first. */
export function auditAll(notes: GameEvent[], known = new Map<string, Verdict>()): Verdict[] {
  const games = Map.groupBy(notes, (note) => tagValue(note, "a") ?? "");
  return [...games]
    .flatMap(([addr, group]) => known.get(`${addr}|${group.length}`) ?? audit(group) ?? [])
    .sort((a, b) => b.endedAt - a.endedAt);
}
