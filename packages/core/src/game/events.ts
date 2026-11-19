import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const KIND = {
  profile: 0,
  chat: 9,
  archive: 64,
  join: 1640,
  move: 1641,
  action: 1642,
  label: 1985,
  zapRequest: 9734,
  zap: 9735,
  game: 30064,
  rating: 30382,
  status: 30315,
} as const;
export const TOPIC = "luft";
/**
 * How long an open game waits for its join, in seconds: a seek in the lobby, a challenge to a
 * player, and one to a bot, which gets longer when it charges so there is time to pay.
 */
export const WAIT = { seek: 600, challenge: 300, bot: 60, paidBot: 180 } as const;
/** How long the relay keeps a withdrawn seek, so clients that had it open learn of it. */
const CANCELLED_TTL = 60;
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

/** Lichess's time for each side's first move, outside tournaments; correspondence gives its days. */
export function firstMoveWindow(tc: string): number {
  const speed = speedOf(tc);
  const clock = parseTc(tc);
  if (clock && "days" in clock) return clock.days * 86_400;
  return speed === "blitz" ? 25 : speed === "rapid" ? 30 : 35;
}

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
    wait: number = WAIT.seek,
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
      ["expiration", String(now + wait)],
      ...(challenged ? [["p", challenged]] : []),
      ["-"],
    ],
  }),
  /**
   * Withdraws an open seek or challenge: it replaces the open event and soon expires itself. A
   * challenge that ran out of time instead stays, naming the player who didn't join.
   */
  cancelled: (
    gameId: string,
    terms: Terms,
    now: number,
    why?: { challenged: string; reason: "expired" },
  ): Template => ({
    kind: KIND.game,
    created_at: now,
    content: "",
    tags: [
      ["d", gameId],
      ["t", TOPIC],
      ["status", "cancelled"],
      ...termTags(terms),
      ...(why
        ? [
            ["reason", why.reason],
            ["p", why.challenged],
          ]
        : [["expiration", String(now + CANCELLED_TTL)]]),
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
    opened = now,
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
      ["opened", String(opened)],
      ["-"],
    ],
  }),
  /**
   * Repeats the terms and the seed it saw, so the host can change neither afterwards. A paid bot
   * names the zap receipt that bought the game in `paidBy`, which spends it.
   */
  join: (
    addr: string,
    host: string,
    terms: Terms,
    session: string,
    seed: string,
    now: number,
    paidBy?: string,
  ): Template => ({
    kind: KIND.join,
    created_at: now,
    content: "",
    tags: [
      ["a", addr],
      ["p", host],
      ...termTags(terms),
      ["session", session],
      ["seed", seed],
      ...(paidBy ? [["e", paidBy]] : []),
    ],
  }),
  /** The challenged player's no, with a reason such as `busy`. */
  decline: (addr: string, host: string, reason: string, now: number): Template => ({
    kind: KIND.join,
    created_at: now,
    content: "",
    tags: [
      ["a", addr],
      ["p", host],
      ["decline", reason],
    ],
  }),
  /**
   * A bot's NIP-38 status, replaced every minute and on changes: online or not, how many of its
   * `max` tables are free, and its price. It expires after 150 s, so a bot that died goes offline.
   */
  status: (
    { online, free, max, msat }: { online: boolean; free: number; max: number; msat: number },
    now: number,
  ): Template => ({
    kind: KIND.status,
    created_at: now,
    content: online ? "online" : "offline",
    tags: [
      ["d", "general"],
      ["t", TOPIC],
      ["status", online ? "online" : "offline"],
      ["free", String(free)],
      ["max", String(max)],
      ["price_msat", String(msat)],
      ["expiration", String(now + STATUS_TTL)],
    ],
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
  /** A NIP-C7 chat line in one of a game's two rooms: its players', or its spectators'. */
  chat: (addr: string, room: "players" | "spectators", text: string, now: number): Template => ({
    kind: KIND.chat,
    created_at: now,
    content: text,
    tags: [
      ["a", addr],
      ["t", TOPIC],
      ["room", room],
    ],
  }),
};

const STATUS_TTL = 150;
/** A bot's status as of `now`: one with no current status event is offline. */
export function readStatus(event: Pick<GameEvent, "tags"> | undefined, now: number) {
  const number = (name: string) => Number(event && tagValue(event, name)) || 0;
  const current = !!event && number("expiration") >= now;
  return {
    online: current && tagValue(event, "status") === "online",
    free: current ? number("free") : 0,
    max: number("max"),
  };
}

/** What a bot or reviewer charges per game, in millisats, and which games it takes. */
export type Fee = {
  role: "bot" | "review";
  msat: number;
  speeds: string[] | null;
  rated: boolean;
  casual: boolean;
};
export type Profile = { name: string; bot: boolean; lud16: string; lud06: string; fee: Fee | null };
export const NOBODY: Profile = { name: "", bot: false, lud16: "", lud06: "", fee: null };

/** Name, the NIP-24 bot flag, the lightning address and the `luft` fee block of a kind 0 event. */
export function profileOf(event: Pick<GameEvent, "content">): Profile {
  try {
    const { name, bot, lud16, lud06, luft } = JSON.parse(event.content);
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const priced = (luft?.role === "bot" || luft?.role === "review") && luft.price_msat >= 0;
    return {
      name: text(name).slice(0, 40),
      bot: bot === true,
      lud16: text(lud16),
      lud06: text(lud06),
      fee: priced
        ? {
            role: luft.role,
            msat: Math.floor(luft.price_msat),
            speeds: Array.isArray(luft.speeds) ? luft.speeds.map(String) : null,
            rated: luft.rated !== false,
            casual: luft.casual !== false,
          }
        : null,
    };
  } catch {
    return NOBODY;
  }
}

/** Whether a service takes a game on these terms; one that names no fee block takes any. */
export const covers = ({ fee }: Profile, { tc, rated }: Terms) =>
  !fee || ((fee.speeds?.includes(speedOf(tc) ?? "") ?? true) && (rated ? fee.rated : fee.casual));
