import type { Verdict } from "./archive.ts";
import {
  type GameEvent,
  hashHex,
  KIND,
  type Speed,
  tagValue,
  type Template,
  TOPIC,
} from "./events.ts";
import { ratedGames, type Rating, ratings, START } from "./glicko.ts";
import type { Reliability } from "./reliability.ts";

type Speeds = Partial<Record<Speed, Rating>>;
/** The rated games a rater worked from: how many, the hash of their addresses in rating order, and when the last one ended. */
export type Cover = { count: number; hash: string; until: number };
export type Asserted = {
  rater: string;
  player: string;
  at: number;
  speeds: Speeds;
  cover: Cover | null;
  reliability: Reliability | null;
};
const RECORD = ["asked", "answered", "median", "games", "abandoned", "unspent"] as const;

export function coverOf(verdicts: Verdict[]): Cover {
  const games = ratedGames(verdicts);
  return {
    count: games.length,
    hash: hashHex(games.map((game) => game.addr).join("\n")),
    until: Math.max(0, ...games.map((game) => game.endedAt)),
  };
}

/**
 * A rater's statement of one player's ratings (NIP-85 kind 30382), with the games it rests on, and
 * optionally how reliably the player has started and kept its games.
 */
export const assertion = (
  player: string,
  speeds: Speeds,
  cover: Cover,
  now: number,
  record?: Reliability,
): Template => ({
  kind: KIND.rating,
  created_at: now,
  content: "",
  tags: [
    ["d", player],
    ["p", player],
    ["t", TOPIC],
    ["covers", String(cover.count), cover.hash, String(cover.until)],
    ...Object.entries(speeds).flatMap(([speed, { r, rd, games }]) => [
      [`rating:${speed}`, String(Math.round(r))],
      [`rd:${speed}`, String(Math.round(rd))],
      [`games:${speed}`, String(games)],
    ]),
    ...(record ? [["reliability", ...RECORD.map((name) => String(record[name] ?? ""))]] : []),
  ],
});

export function readAssertion(event: GameEvent): Asserted | null {
  const player = tagValue(event, "d");
  if (event.kind !== KIND.rating || !player) return null;
  const speeds: Speeds = {};
  for (const [name, value] of event.tags) {
    const [, speed] = name.match(/^rating:(blitz|rapid|classical|correspondence)$/) ?? [];
    if (speed)
      speeds[speed as Speed] = {
        r: Number(value),
        rd: Number(tagValue(event, `rd:${speed}`)),
        vol: START.vol,
        games: Number(tagValue(event, `games:${speed}`)),
      };
  }
  const [, count, hash, until] = event.tags.find((tag) => tag[0] === "covers") ?? [];
  const [, ...record] = event.tags.find((tag) => tag[0] === "reliability") ?? [];
  return {
    rater: event.pubkey,
    player,
    at: event.created_at,
    speeds,
    cover: hash ? { count: Number(count), hash, until: Number(until) } : null,
    reliability: record.length
      ? (Object.fromEntries(
          RECORD.map((name, i) => [name, record[i] ? Number(record[i]) : null]),
        ) as Reliability)
      : null,
  };
}

/** The newest assertion per player among those the trusted raters signed. */
export function trusted(events: GameEvent[], raters: string[]): Map<string, Asserted> {
  const known = new Map<string, Asserted>();
  for (const event of events) {
    const read = raters.includes(event.pubkey) ? readAssertion(event) : null;
    if (read && (known.get(read.player)?.at ?? -1) < read.at) known.set(read.player, read);
  }
  return known;
}

/** A trusted rater's numbers where it has spoken, the ratings computed here for everyone else. */
export function withTrusted(local: Map<string, Speeds>, known: Map<string, Asserted>) {
  const table = new Map(local);
  for (const [player, { speeds }] of known) table.set(player, speeds);
  return table;
}

/**
 * Recomputes one assertion from the audited games this verifier has. It holds if the games up to
 * the rater's last one are the games the rater committed to, and they give the same numbers.
 */
export function verify(
  asserted: Asserted,
  verdicts: Verdict[],
  isBot?: (pubkey: string) => boolean,
): { ok: boolean; detail: string } {
  const { cover, speeds, player } = asserted;
  if (!cover) return { ok: false, detail: "The assertion doesn't say which games it covers." };
  const games = ratedGames(verdicts).filter((game) => game.endedAt <= cover.until);
  const mine = coverOf(games);
  if (mine.hash !== cover.hash)
    return {
      ok: false,
      detail: `The rater covered ${cover.count} games, this browser finds ${mine.count} up to the same moment, or other ones.`,
    };
  const computed = ratings(games, isBot).get(player) ?? {};
  const show = (rating?: Rating) =>
    rating ? `${Math.round(rating.r)} ±${Math.round(rating.rd)} over ${rating.games}` : "nothing";
  const wrong = [...new Set([...Object.keys(speeds), ...Object.keys(computed)])]
    .map((speed) => [speed, show(speeds[speed as Speed]), show(computed[speed as Speed])])
    .filter(([, said, found]) => said !== found)
    .map(([speed, said, found]) => `${speed}: asserted ${said}, recomputed ${found}`);
  return wrong.length
    ? { ok: false, detail: wrong.join("; ") }
    : { ok: true, detail: `Recomputed from ${mine.count} games.` };
}
