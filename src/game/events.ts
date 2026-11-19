import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const KIND = {
  profile: 0,
  archive: 64,
  join: 1640,
  move: 1641,
  action: 1642,
  label: 1985,
  game: 30064,
  rating: 30382,
} as const;
export const TOPIC = "luft";
export const SEEK_TTL = 15 * 60;
export const ACTIONS = ["resign", "abort", "draw-offer", "draw-accept", "claim-time"] as const;

export type Action = (typeof ACTIONS)[number];
export type GameEvent = {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  sig?: string;
};
export type Template = Pick<GameEvent, "kind" | "tags" | "content" | "created_at">;
export type Speed = "blitz" | "rapid" | "classical" | "correspondence";
export type Clock = { base: number; inc: number } | { days: number };
/** What two players agree on before the first move. */
export type Terms = { tc: string; rated: boolean };

export const hashHex = (text: string) => bytesToHex(sha256(utf8ToBytes(text)));
export const address = (host: string, gameId: string) => `${KIND.game}:${host}:${gameId}`;
export const tagValue = (event: Pick<GameEvent, "tags">, name: string) =>
  event.tags.find((tag) => tag[0] === name)?.[1];

/** `300+3` is five minutes plus three seconds a move, `2d` is two days for every move. */
export function parseTc(tc: string): Clock | null {
  const live = tc.match(/^(\d{1,5})\+(\d{1,3})$/);
  if (live) return { base: Number(live[1]), inc: Number(live[2]) };
  const daily = tc.match(/^(\d{1,2})d$/);
  return daily && Number(daily[1]) > 0 ? { days: Number(daily[1]) } : null;
}

/**
 * Lichess's speed classes: a game is expected to last base + 40 increments. Anything under three
 * minutes is bullet, which this client does not play, so it has no speed and no game starts.
 */
export function speedOf(tc: string): Speed | null {
  const clock = parseTc(tc);
  if (!clock) return null;
  if ("days" in clock) return "correspondence";
  const expected = clock.base + 40 * clock.inc;
  return expected < 180 ? null : expected < 480 ? "blitz" : expected < 1500 ? "rapid" : "classical";
}

export const termsOf = (event: Pick<GameEvent, "tags">): Terms => ({
  tc: tagValue(event, "tc") ?? "",
  rated: tagValue(event, "rated") === "1",
});
const termTags = ({ tc, rated }: Terms) => [
  ["tc", tc],
  ["rated", rated ? "1" : "0"],
];

/** White is decided by a salt the host committed to before it saw the join. */
export const hostIsWhite = (salt: string, joinId: string) =>
  parseInt(hashHex(`${salt}:${joinId}`).slice(0, 2), 16) % 2 === 0;

export const build = {
  /** A seek anyone may join, or with `challenged` a challenge to one player. */
  open: (
    gameId: string,
    terms: Terms,
    session: string,
    seed: string,
    now: number,
    challenged?: string,
  ): Template => ({
    kind: KIND.game,
    created_at: now,
    content: "",
    tags: [
      ["d", gameId],
      ["t", TOPIC],
      ["status", "open"],
      ...termTags(terms),
      ["session", session],
      ["seed", seed],
      ["expiration", String(now + SEEK_TTL)],
      ...(challenged ? [["p", challenged]] : []),
      ["-"],
    ],
  }),
  playing: (
    gameId: string,
    terms: Terms,
    session: string,
    salt: string,
    join: Pick<GameEvent, "id" | "pubkey">,
    now: number,
  ): Template => ({
    kind: KIND.game,
    created_at: now,
    content: "",
    tags: [
      ["d", gameId],
      ["t", TOPIC],
      ["status", "playing"],
      ...termTags(terms),
      ["session", session],
      ["salt", salt],
      ["p", join.pubkey],
      ["e", join.id],
      ["-"],
    ],
  }),
  /** Repeats the terms and the seed it saw, so the host can change neither afterwards. */
  join: (
    addr: string,
    host: string,
    terms: Terms,
    session: string,
    seed: string,
    now: number,
  ): Template => ({
    kind: KIND.join,
    created_at: now,
    content: "",
    tags: [["a", addr], ["p", host], ...termTags(terms), ["session", session], ["seed", seed]],
  }),
  /** Tag order is fixed: an archive rebuilds this event from the SAN, the time and the signature. */
  move: (addr: string, ply: number, prev: string, san: string, fen: string, now: number) => ({
    kind: KIND.move,
    created_at: now,
    content: san,
    tags: [
      ["a", addr],
      ["ply", String(ply)],
      ["e", prev],
      ["fen", fen],
    ],
  }),
  /** `ply` is the number of moves played when the action was taken. */
  action: (addr: string, ply: number, action: Action, now: number): Template => ({
    kind: KIND.action,
    created_at: now,
    content: "",
    tags: [
      ["a", addr],
      ["ply", String(ply)],
      ["action", action],
    ],
  }),
};

export type Profile = { name: string; bot: boolean };
/** Name and the NIP-24 bot flag from a kind 0 event. */
export function profileOf(event: Pick<GameEvent, "content">): Profile {
  try {
    const { name, bot } = JSON.parse(event.content);
    return { name: typeof name === "string" ? name.slice(0, 40) : "", bot: bot === true };
  } catch {
    return { name: "", bot: false };
  }
}
