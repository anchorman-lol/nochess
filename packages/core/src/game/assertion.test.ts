import { expect, test } from "vitest";
import type { Verdict } from "./archive.ts";
import { assertion, coverOf, readAssertion, trusted, verify, withTrusted } from "./assertion.ts";
import { ratings } from "./glicko.ts";
import { sign } from "./testkit.ts";

const [A, B, C, RATER, STRANGER] = ["a", "b", "c", "d", "e"].map((char) => char.repeat(64));
const game = (n: number, white: string, black: string, result: Verdict["result"]): Verdict => ({
  addr: `31640:${white}:g${n}`,
  players: [white, black],
  result,
  termination: "checkmate",
  tc: "300+3",
  rated: true,
  speed: "blitz",
  endedAt: 100 * n,
  sans: [],
  noStart: null,
});
const GAMES = [game(1, A, B, "1-0"), game(2, B, C, "0-1"), game(3, C, A, "1/2-1/2")];
const publish = (player: string, games = GAMES, rater = RATER, now = 1000) =>
  sign(rater, assertion(player, ratings(games).get(player)!, coverOf(games), now));

test("an assertion carries a player's ratings and a commitment to the games behind them", () => {
  const read = readAssertion(publish(A))!;
  const local = ratings(GAMES).get(A)!.blitz!;
  expect(read).toMatchObject({ rater: RATER, player: A, at: 1000 });
  expect(read.speeds.blitz).toMatchObject({
    r: Math.round(local.r),
    rd: Math.round(local.rd),
    games: 2,
  });
  expect(read.cover).toEqual({ count: 3, until: 300, hash: coverOf(GAMES).hash });
  expect(coverOf([...GAMES].reverse())).toEqual(coverOf(GAMES));
  expect(coverOf(GAMES.slice(0, 2)).hash).not.toBe(coverOf(GAMES).hash);
  expect(readAssertion(sign(RATER, { kind: 1, created_at: 1, content: "", tags: [] }))).toBeNull();
});

test("recomputing from the same games verifies an assertion, also once later games exist", () => {
  const read = readAssertion(publish(A))!;
  expect(verify(read, GAMES)).toEqual({ ok: true, detail: "Recomputed from 3 games." });
  expect(verify(read, [...GAMES, game(4, A, B, "0-1")]).ok).toBe(true);
});

test("a verifier that finds other games than the rater covered says so", () => {
  const check = verify(readAssertion(publish(A))!, GAMES.slice(1));
  expect(check.ok).toBe(false);
  expect(check.detail).toContain("covered 3 games");
  expect(check.detail).toContain("finds 2");
});

test("a number that doesn't follow from the covered games is a mismatch", () => {
  const event = publish(A);
  const tag = event.tags.find((t) => t[0] === "rating:blitz")!;
  const honest = tag[1];
  tag[1] = "2400";
  const check = verify(readAssertion(event)!, GAMES);
  expect(check.ok).toBe(false);
  expect(check.detail).toContain(`blitz: asserted 2400`);
  expect(check.detail).toContain(`recomputed ${honest}`);
  const uncovered = { ...readAssertion(publish(A))!, cover: null };
  expect(verify(uncovered, GAMES).ok).toBe(false);
});

test("only trusted raters count, the newest assertion per player, and the rest is computed here", () => {
  const stale = publish(A, GAMES.slice(0, 1), RATER, 500);
  const events = [stale, publish(A), publish(B, GAMES, STRANGER, 2000)];
  const known = trusted(events, [RATER]);
  expect([...known.keys()]).toEqual([A]);
  expect(known.get(A)!.at).toBe(1000);
  const local = ratings(GAMES);
  const table = withTrusted(local, known);
  expect(table.get(A)!.blitz!.r).toBe(Math.round(local.get(A)!.blitz!.r));
  expect(table.get(B)).toBe(local.get(B));
  expect(withTrusted(local, trusted(events, []))).toEqual(local);
});

test("an assertion can carry a reliability record, read back whole", () => {
  const record = { asked: 412, answered: 404, median: 2, games: 300, abandoned: 6, unspent: 3 };
  const event = sign(RATER, assertion(A, {}, coverOf(GAMES), 1000, record));
  expect(readAssertion(event)!.reliability).toEqual(record);
  const untimed = sign(RATER, assertion(A, {}, coverOf(GAMES), 1000, { ...record, median: null }));
  expect(readAssertion(untimed)!.reliability!.median).toBeNull();
  expect(readAssertion(publish(A))!.reliability).toBeNull();
});
