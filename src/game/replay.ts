import { Chess } from "chess.js";
import {
  address,
  type GameEvent,
  hashHex,
  hostIsWhite,
  KIND,
  parseTc,
  speedOf,
  tagValue,
  termsOf,
} from "./events.ts";

/** 0 is White, 1 is Black. */
export type Seat = 0 | 1;
export type Result = "1-0" | "0-1" | "1/2-1/2" | "*";
export type Game = {
  /** `missing`: no game event, or one this client won't play (bullet, a join that doesn't fit). */
  phase: "missing" | "open" | "playing" | "finished";
  host: string;
  gameId: string;
  addr: string;
  tc: string;
  rated: boolean;
  /** An open game that only this player may join. */
  challenged: string | null;
  /** While open: the join the host should accept. Afterwards: the one it did. */
  join: GameEvent | null;
  /** Players and their session keys, White first. */
  players: [string, string] | null;
  sessions: [string, string] | null;
  startedAt: number;
  fen: string;
  sans: string[];
  /** When each move was made, in relay seconds. */
  times: number[];
  ids: string[];
  /** Seconds each side had left after its last move; unused in correspondence. */
  clocks: [number, number];
  /** When the side to move runs out, in relay seconds; null until both have moved once. */
  deadline: number | null;
  /** Who has a draw offer the other side can still accept. */
  drawOffer: Seat | null;
  result: Result | null;
  termination: string;
  endedAt: number;
  /** The signed events the result rests on, in order. */
  proof: GameEvent[];
};

const byTime = (a: GameEvent, b: GameEvent) =>
  a.created_at - b.created_at || a.id.localeCompare(b.id);
const plyOf = (event: GameEvent) => Number(tagValue(event, "ply"));
const win = (seat: Seat): Result => (seat === 0 ? "1-0" : "0-1");
const other = (seat: Seat) => (1 - seat) as Seat;

export const seatOf = (game: Game, pubkey: string): Seat | null =>
  game.players?.includes(pubkey) ? (game.players.indexOf(pubkey) as Seat) : null;
export const turnOf = (game: Game) => (game.sans.length % 2) as Seat;

/**
 * Rebuilds a game from whatever events a relay returned for it. The same events always give the
 * same game, whoever replays them, so this function is the only judge.
 */
export function replay(events: GameEvent[], host: string, gameId: string): Game {
  const addr = address(host, gameId);
  const chess = new Chess();
  const game: Game = {
    phase: "missing",
    host,
    gameId,
    addr,
    tc: "",
    rated: false,
    challenged: null,
    join: null,
    players: null,
    sessions: null,
    startedAt: 0,
    fen: chess.fen(),
    sans: [],
    times: [],
    ids: [],
    clocks: [0, 0],
    deadline: null,
    drawOffer: null,
    result: null,
    termination: "",
    endedAt: 0,
    proof: [],
  };
  const unique = [...new Map(events.map((event) => [event.id, event])).values()].sort(byTime);
  const lobby = unique.findLast(
    (event) => event.kind === KIND.game && event.pubkey === host && tagValue(event, "d") === gameId,
  );
  if (!lobby) return game;
  const terms = termsOf(lobby);
  const clock = parseTc(terms.tc);
  if (!clock || !speedOf(terms.tc)) return game;
  Object.assign(game, terms);

  const about = unique.filter((event) => tagValue(event, "a") === addr);
  const fits = (join: GameEvent) =>
    join.pubkey !== host &&
    termsOf(join).tc === terms.tc &&
    termsOf(join).rated === terms.rated &&
    Boolean(tagValue(join, "session"));
  const joins = about.filter((event) => event.kind === KIND.join && fits(event));
  if (tagValue(lobby, "status") === "open") {
    game.phase = "open";
    game.challenged = tagValue(lobby, "p") ?? null;
    game.join =
      joins.find(
        (join) =>
          tagValue(join, "seed") === tagValue(lobby, "seed") &&
          (!game.challenged || join.pubkey === game.challenged),
      ) ?? null;
    return game;
  }

  const join = joins.find((event) => event.id === tagValue(lobby, "e"));
  const salt = tagValue(lobby, "salt") ?? "";
  const hostSession = tagValue(lobby, "session");
  if (
    !join ||
    !hostSession ||
    join.pubkey !== tagValue(lobby, "p") ||
    hashHex(salt) !== tagValue(join, "seed")
  )
    return game;
  const hostSeat: Seat = hostIsWhite(salt, join.id) ? 0 : 1;
  const players: [string, string] = [host, host];
  const sessions: [string, string] = [hostSession, hostSession];
  players[other(hostSeat)] = join.pubkey;
  sessions[other(hostSeat)] = tagValue(join, "session")!;
  Object.assign(game, { phase: "playing", join, players, sessions, startedAt: lobby.created_at });
  game.proof.push(lobby, join);
  if ("base" in clock) game.clocks = [clock.base, clock.base];

  const moves = about.filter((event) => event.kind === KIND.move);
  const actions = about.filter((event) => event.kind === KIND.action);
  const lastPly = sessions.map((key) =>
    Math.max(0, ...moves.filter((move) => move.pubkey === key).map(plyOf)),
  );
  const offers: ({ ply: number; event: GameEvent } | undefined)[] = [];
  const end = (result: Result, termination: string, at: number, ...proof: GameEvent[]) => {
    Object.assign(game, { phase: "finished", result, termination, endedAt: at, deadline: null });
    game.proof.push(...proof);
  };
  const attempt = (san: string) => {
    try {
      const made = chess.move(san, { strict: true });
      chess.undo();
      return made.san === san ? made.after : null;
    } catch {
      return null;
    }
  };

  while (!game.result) {
    const n = game.sans.length;
    const turn = turnOf(game);
    const last = game.times.at(-1) ?? game.startedAt;
    // Offers first: an offer and its acceptance can carry the same second.
    const taken = actions.filter((event) => plyOf(event) === n);
    const isOffer = (event: GameEvent) => tagValue(event, "action") === "draw-offer";
    for (const action of [...taken.filter(isOffer), ...taken.filter((e) => !isOffer(e))]) {
      const seat = sessions.indexOf(action.pubkey) as Seat;
      const what = tagValue(action, "action");
      // An ending the same player played on after was written later, so it doesn't count.
      if (!(seat in sessions) || game.result || (what !== "draw-offer" && lastPly[seat] > n))
        continue;
      const offer = offers[other(seat)];
      if (what === "draw-offer") offers[seat] = { ply: n, event: action };
      else if (what === "abort" || what === "resign") {
        if (n < 2) end("*", "aborted", action.created_at, action);
        else if (what === "resign") end(win(other(seat)), "resignation", action.created_at, action);
      } else if (what === "draw-accept" && offer && n - offer.ply <= 1)
        end("1/2-1/2", "agreement", action.created_at, offer.event, action);
    }
    if (game.result) break;

    game.deadline =
      "days" in clock ? last + clock.days * 86_400 : n >= 2 ? last + game.clocks[turn] : null;
    const { deadline } = game;
    const prev = game.ids.at(-1) ?? join.id;
    const tried = moves.filter(
      (move) =>
        plyOf(move) === n + 1 &&
        move.pubkey === sessions[turn] &&
        tagValue(move, "e") === prev &&
        attempt(move.content) === tagValue(move, "fen"),
    );
    if (new Set(tried.map((move) => move.content)).size > 1) {
      end(win(other(turn)), "equivocation", tried[1].created_at, tried[0], tried[1]);
      break;
    }
    const [move] = tried;
    if (move && deadline !== null && move.created_at > deadline) {
      end(win(other(turn)), "time", deadline, move);
      break;
    }
    if (!move) {
      const claim = actions.find(
        (event) =>
          plyOf(event) === n &&
          event.pubkey === sessions[other(turn)] &&
          tagValue(event, "action") === "claim-time" &&
          deadline !== null &&
          event.created_at > deadline,
      );
      if (claim) end(win(other(turn)), "time", deadline!, claim);
      break;
    }

    const at = Math.max(move.created_at, last);
    chess.move(move.content);
    if ("base" in clock && deadline !== null) game.clocks[turn] = deadline - at + clock.inc;
    game.fen = chess.fen();
    game.sans.push(move.content);
    game.times.push(at);
    game.ids.push(move.id);
    game.proof.push(move);
    if (chess.isCheckmate()) end(win(turn), "checkmate", at);
    else if (chess.isGameOver())
      end(
        "1/2-1/2",
        chess.isStalemate()
          ? "stalemate"
          : chess.isInsufficientMaterial()
            ? "insufficient material"
            : chess.isThreefoldRepetition()
              ? "threefold repetition"
              : "fifty-move rule",
        at,
      );
  }

  const open = ([0, 1] as const).find((seat) => {
    const offer = offers[seat];
    return offer && game.sans.length - offer.ply <= 1;
  });
  game.drawOffer = game.result ? null : (open ?? null);
  return game;
}
