import type { Zap } from "../zap/zap.ts";
import type { Verdict } from "./archive.ts";
import { address, type GameEvent, KIND, tagValue, WAIT } from "./events.ts";

/** How a player, above all a bot, has kept its games, from public events alone. */
export type Reliability = {
  /** Challenges that have had their answer or ran out: joined, declined, expired or paid and never joined. */
  asked: number;
  /** Joined or declined. */
  answered: number;
  /** Median seconds from the challenge, or from its payment, to the join; null without a timed one. */
  median: number | null;
  /** Archived games, and those it abandoned: a first move never made, or a game lost on time. */
  games: number;
  abandoned: number;
  /** Payments for a challenge that no join has spent, once the wait for them is over. */
  unspent: number;
};
export type Sources = {
  /** Game events (kind 30064), the newest per game. */
  lobbies: GameEvent[];
  /** The player's joins and declines (kind 1640). */
  joins: GameEvent[];
  /** Checked zaps to the player. */
  zaps: Zap[];
  verdicts: Verdict[];
};

export function reliability(pubkey: string, sources: Sources, now: number): Reliability {
  const { lobbies, zaps, verdicts } = sources;
  const joins = sources.joins.filter(
    (event) => event.pubkey === pubkey && event.kind === KIND.join,
  );
  const answers = new Map(joins.map((event) => [tagValue(event, "a") ?? "", event]));
  const spent = new Set(joins.map((event) => tagValue(event, "e")));
  const asked = new Set(answers.keys());
  const opened = new Map<string, number>();
  for (const lobby of lobbies) {
    if (tagValue(lobby, "p") !== pubkey) continue;
    const addr = address(lobby.pubkey, tagValue(lobby, "d") ?? "");
    const status = tagValue(lobby, "status");
    const lapsed = status === "open" && Number(tagValue(lobby, "expiration")) < now;
    if (status === "playing") opened.set(addr, Number(tagValue(lobby, "opened")));
    if (lapsed || tagValue(lobby, "reason") === "expired") asked.add(addr);
  }
  const unspent = zaps.filter(
    (zap) =>
      zap.to === pubkey &&
      zap.addr?.startsWith(`${KIND.game}:`) &&
      zap.at < now - WAIT.paidBot &&
      !spent.has(zap.id),
  );
  for (const zap of unspent) asked.add(zap.addr!);
  /** The answer can't come before the payment, so a paid challenge is timed from it. */
  const startOf = (addr: string) => {
    const paid = Math.min(
      ...zaps.filter((zap) => zap.addr === addr && zap.to === pubkey).map((zap) => zap.at),
    );
    return Number.isFinite(paid) ? paid : (opened.get(addr) ?? NaN);
  };
  const times = [...answers]
    .map(([addr, answer]) => answer.created_at - startOf(addr))
    .filter(Number.isFinite)
    .map((seconds) => Math.max(0, seconds))
    .sort((a, b) => a - b);
  const mine = verdicts.filter((verdict) => verdict.players.includes(pubkey));
  const abandoned = mine.filter(({ players, noStart, termination, result }) => {
    const seat = players.indexOf(pubkey);
    return noStart === seat || (termination === "time" && result === (seat ? "1-0" : "0-1"));
  });
  return {
    asked: asked.size,
    answered: answers.size,
    median: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
    games: mine.length,
    abandoned: abandoned.length,
    unspent: unspent.length,
  };
}

const percent = (part: number, whole: number) => `${Math.floor((100 * part) / whole)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "answered 98% of 412, median 2 s · finished 98% of 300 games"; a bot without challenges is new. */
export function describeReliability(record: Reliability, bot: boolean): string {
  const { asked, answered, median, games, abandoned, unspent } = record;
  if (bot && !asked && !games) return "new bot, no record yet";
  return [
    bot && asked
      ? `answered ${percent(answered, asked)} of ${asked}${median === null ? "" : `, median ${median} s`}`
      : "",
    games ? `finished ${percent(games - abandoned, games)} of ${plural(games, "game")}` : "",
    unspent ? `${plural(unspent, "paid challenge")} never joined` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Whether a bot has no record to judge it by. */
export const unproven = (record: Reliability | undefined) => !record?.asked && !record?.games;
