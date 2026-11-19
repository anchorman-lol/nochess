import { expect, test } from "vitest";
import type { Zap } from "../zap/zap.ts";
import type { Verdict } from "./archive.ts";
import { address, build, WAIT } from "./events.ts";
import { describeReliability, reliability } from "./reliability.ts";
import { sign } from "./testkit.ts";

const [BOT, HUMAN, OTHER] = ["a", "b", "c"].map((char) => char.repeat(64));
const NOW = 10_000;
const TERMS = { tc: "300+3", rated: true };
const addr = (id: string) => address(HUMAN, id);

/** A challenge the bot joined `after` seconds after it was opened at `opened`. */
function joined(id: string, opened: number, after: number, paidBy?: string) {
  const join = sign(BOT, build.join(addr(id), HUMAN, TERMS, "s", "seed", opened + after, paidBy));
  const lobby = sign(HUMAN, build.playing(id, TERMS, "s", "salt", join, opened + after, opened));
  return { join, lobby };
}
const zap = (id: string, game: string, at: number): Zap => ({
  id,
  from: HUMAN,
  to: BOT,
  msat: 21_000,
  addr: addr(game),
  comment: "",
  at,
  bolt11: "",
});
const verdict = (players: [string, string], result: Verdict["result"], how: string): Verdict => ({
  addr: addr("v"),
  players,
  result,
  termination: how,
  tc: "300+3",
  rated: true,
  speed: "blitz",
  endedAt: 0,
  sans: [],
  noStart: how === "no start" ? 1 : null,
});

test("a bot with no challenges has no record", () => {
  const record = reliability(BOT, { lobbies: [], joins: [], zaps: [], verdicts: [] }, NOW);
  expect(record).toEqual({
    asked: 0,
    answered: 0,
    median: null,
    games: 0,
    abandoned: 0,
    unspent: 0,
  });
  expect(describeReliability(record, true)).toBe("new bot, no record yet");
  expect(describeReliability(record, false)).toBe("");
});

test("answers count joins and declines against challenges that ran out, timed from the challenge or its payment", () => {
  const a = joined("g1", 100, 2);
  const b = joined("g2", 200, 4);
  const paid = joined("g3", 300, 90, "r1");
  const declined = sign(BOT, build.decline(addr("g4"), HUMAN, "busy", 403));
  const expired = sign(
    HUMAN,
    build.cancelled("g5", TERMS, 560, { challenged: BOT, reason: "expired" }),
  );
  const stale = sign(HUMAN, build.open("g6", TERMS, "s", "seed", 600, BOT, WAIT.bot));
  const pending = sign(HUMAN, build.open("g7", TERMS, "s", "seed", NOW - 10, BOT, WAIT.bot));
  const record = reliability(
    BOT,
    {
      lobbies: [a.lobby, b.lobby, paid.lobby, expired, stale, pending],
      joins: [a.join, b.join, paid.join, declined],
      zaps: [zap("r1", "g3", 388)],
      verdicts: [],
    },
    NOW,
  );
  expect(record).toMatchObject({ asked: 6, answered: 4, median: 2, unspent: 0 });
});

test("a receipt no join spent counts once its challenge can no longer be answered", () => {
  const spent = joined("g1", 100, 2, "r1");
  const zaps = [zap("r1", "g1", 100), zap("r2", "g2", 500), zap("r3", "g3", NOW - 30)];
  const record = reliability(
    BOT,
    { lobbies: [spent.lobby], joins: [spent.join], zaps, verdicts: [] },
    NOW,
  );
  expect(record).toMatchObject({ asked: 2, answered: 1, unspent: 1 });
});

test("games abandoned are first moves never made and games lost on time", () => {
  const verdicts = [
    verdict([HUMAN, BOT], "1-0", "checkmate"),
    verdict([HUMAN, BOT], "*", "no start"),
    verdict([HUMAN, BOT], "1-0", "time"),
    verdict([BOT, HUMAN], "1-0", "time"),
    verdict([HUMAN, OTHER], "*", "aborted"),
  ];
  const record = reliability(BOT, { lobbies: [], joins: [], zaps: [], verdicts }, NOW);
  expect(record).toMatchObject({ games: 4, abandoned: 2 });
  expect(reliability(HUMAN, { lobbies: [], joins: [], zaps: [], verdicts }, NOW)).toMatchObject({
    games: 5,
    abandoned: 1,
  });
});

test("the record reads as a sentence", () => {
  const record = { asked: 412, answered: 404, median: 2, games: 300, abandoned: 6, unspent: 3 };
  expect(describeReliability(record, true)).toBe(
    "answered 98% of 412, median 2 s · finished 98% of 300 games · 3 paid challenges never joined",
  );
  expect(describeReliability({ ...record, asked: 0, unspent: 0 }, false)).toBe(
    "finished 98% of 300 games",
  );
});
