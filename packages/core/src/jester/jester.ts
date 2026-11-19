import { Chess } from "chess.js";
import type { GameEvent } from "../game/events.ts";
import type { Result } from "../game/replay.ts";

/**
 * Jester v0, the chess format of jesterui, Amethyst, nostr.blue and Blind Chess: every event is
 * kind 30 with JSON content. A start (content kind 0) refers to the hash of the starting position,
 * so lobbies find it with `#e`; a move (content kind 1) refers to the start and the move before it
 * and carries the whole history. Read here only, never written.
 */
export const JESTER_KIND = 30;
export const START_REF = "b1791d7fc9ae3d38966568c257ffb3a02cbf8394cdb4805bc70f64fc3c0b6879";
const START_FEN = new Chess().fen();
/** How long the side to move must be silent before an abandonment claim counts: Amethyst's 3 days. */
const ABANDONED_AFTER = 3 * 86_400;

type Content = {
  kind: number;
  fen?: string;
  move?: string;
  history: string[];
  playerColor?: string;
  player_color?: string;
  result?: string;
  termination?: string;
  draw_offered?: boolean;
};
/** A Jester game as its seated players played it. A seat is null while nobody has taken it. */
export type JesterGame = {
  id: string;
  white: string | null;
  black: string | null;
  sans: string[];
  fen: string;
  result: Result | null;
  termination: string;
  updatedAt: number;
};

function read(event: GameEvent): Content | null {
  try {
    const content = JSON.parse(event.content);
    return typeof content?.kind === "number" && Array.isArray(content.history ?? [])
      ? { ...content, history: content.history ?? [] }
      : null;
  } catch {
    return null;
  }
}
const refs = (event: GameEvent) => event.tags.filter(([name]) => name === "e").map(([, id]) => id);
const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((san, i) => san === b[i]);
const win = (seat: number): Result => (seat === 0 ? "1-0" : "0-1");
const byTime = (a: GameEvent, b: GameEvent) =>
  a.created_at - b.created_at || a.id.localeCompare(b.id);

/** Every public Jester game among the events, newest activity first. */
export function jesterGames(events: GameEvent[]): JesterGame[] {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()].filter(
    (event) => event.kind === JESTER_KIND && read(event),
  );
  const starts = unique.filter((event) => {
    const content = read(event)!;
    return (
      content.kind === 0 &&
      !content.history.length &&
      (content.fen ?? START_FEN) === START_FEN &&
      refs(event).includes(START_REF)
    );
  });
  const moves = Map.groupBy(
    unique.filter((event) => read(event)!.kind === 1),
    (event) => refs(event)[0],
  );
  return starts
    .map((start) => mainLine(start, moves.get(start.id) ?? []))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * quartz's seat rules: the challenger sits in its colour, and a `p` on the start seats the other
 * player; otherwise the first player but the challenger to move for the empty seat takes it. A move
 * counts when its author holds the seat to move and its history is the line so far plus itself,
 * preferring the one that names the previous move, then the earliest. Moves are replayed with
 * chess.js and the line stops at the first illegal one. The board decides mates and draws;
 * otherwise a resignation, an accepted draw offer or an abandonment claim ends the game.
 */
function mainLine(start: GameEvent, events: GameEvent[]): JesterGame {
  const content = read(start)!;
  const seat = (content.playerColor ?? content.player_color) === "black" ? 1 : 0;
  const seats: (string | null)[] = [null, null];
  seats[seat] = start.pubkey;
  const named = start.tags.find(([name, key]) => name === "p" && key?.length === 64)?.[1];
  if (named && named !== start.pubkey) seats[1 - seat] = named;
  const chess = new Chess();
  const line: GameEvent[] = [];
  let history: string[] = [];
  for (;;) {
    const turn = line.length % 2;
    const tip = line.at(-1) ?? start;
    const [next] = events
      .filter((event) => {
        const { move, history: moved } = read(event)!;
        return (
          !!move &&
          moved.length === history.length + 1 &&
          moved.at(-1) === move &&
          same(moved.slice(0, -1), history) &&
          (seats[turn] ? event.pubkey === seats[turn] : event.pubkey !== start.pubkey)
        );
      })
      .sort(
        (a, b) => Number(refs(a)[1] !== tip.id) - Number(refs(b)[1] !== tip.id) || byTime(a, b),
      );
    if (!next) break;
    try {
      chess.move(read(next)!.move!);
    } catch {
      break;
    }
    seats[turn] ??= next.pubkey;
    line.push(next);
    history = read(next)!.history;
    if (chess.isGameOver()) break;
  }

  const game: JesterGame = {
    id: start.id,
    white: seats[0],
    black: seats[1],
    sans: chess.history(),
    fen: chess.fen(),
    result: null,
    termination: "",
    updatedAt: Math.max(start.created_at, ...line.map((event) => event.created_at)),
  };
  const toMove = line.length % 2;
  if (chess.isCheckmate()) return { ...game, result: win(1 - toMove), termination: "checkmate" };
  if (chess.isGameOver())
    return {
      ...game,
      result: "1/2-1/2",
      termination: chess.isStalemate()
        ? "stalemate"
        : chess.isInsufficientMaterial()
          ? "insufficient material"
          : chess.isThreefoldRepetition()
            ? "threefold repetition"
            : "fifty-move rule",
    };

  const tip = line.at(-1);
  const [ending] = events
    .filter((event) => {
      const { move, history: at, result, termination } = read(event)!;
      const author = seats.indexOf(event.pubkey);
      if (move || !same(at, history) || author < 0 || !seats[1 - author]) return false;
      if (termination === "resignation") return result === win(1 - author);
      if (termination === "draw_agreement")
        return (
          result === "1/2-1/2" && !!tip && tip.pubkey !== event.pubkey && !!read(tip)!.draw_offered
        );
      return (
        termination === "abandonment" &&
        result === win(author) &&
        author !== toMove &&
        !!tip &&
        event.created_at - tip.created_at >= ABANDONED_AFTER
      );
    })
    .sort(byTime);
  if (!ending) return game;
  const { result, termination } = read(ending)!;
  return {
    ...game,
    result: result as Result,
    termination: termination!.replace("_", " "),
    updatedAt: ending.created_at,
  };
}
