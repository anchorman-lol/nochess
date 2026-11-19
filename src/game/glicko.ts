import type { Verdict } from "./archive.ts";
import type { Speed } from "./events.ts";

/** Lichess's Glicko-2 settings: start at 1500 ± 500, volatility 0.09, tau 0.75, RD never under 45. */
export type Rating = { r: number; rd: number; vol: number; games: number };
export const START: Rating = { r: 1500, rd: 500, vol: 0.09, games: 0 };
export const PROVISIONAL_RD = 110;
const SCALE = 173.7178;
const MIN_RD = 45;

/** One Glicko-2 rating period for `player`, who scored `score` (1, ½, 0) against each opponent. */
export function rate(
  player: Rating,
  results: { opponent: Rating; score: number }[],
  tau = 0.75,
): Rating {
  const mu = (player.r - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const g = (p: number) => 1 / Math.sqrt(1 + (3 * p * p) / Math.PI ** 2);
  let vInv = 0;
  let sum = 0;
  for (const { opponent, score } of results) {
    const gj = g(opponent.rd / SCALE);
    const e = 1 / (1 + Math.exp(-gj * (mu - (opponent.r - 1500) / SCALE)));
    vInv += gj * gj * e * (1 - e);
    sum += gj * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;
  const a = Math.log(player.vol ** 2);
  const f = (x: number) =>
    (Math.exp(x) * (delta ** 2 - phi ** 2 - v - Math.exp(x))) /
      (2 * (phi ** 2 + v + Math.exp(x)) ** 2) -
    (x - a) / tau ** 2;
  let A = a;
  let B: number;
  if (delta ** 2 > phi ** 2 + v) B = Math.log(delta ** 2 - phi ** 2 - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) [A, fA] = [B, fB];
    else fA /= 2;
    [B, fB] = [C, fC];
  }
  const vol = Math.exp(A / 2);
  const phiNew = 1 / Math.sqrt(1 / (phi ** 2 + vol ** 2) + vInv);
  return {
    r: 1500 + SCALE * (mu + phiNew ** 2 * sum),
    rd: Math.max(MIN_RD, SCALE * phiNew),
    vol,
    games: player.games + results.length,
  };
}

/** The games that move ratings, in the order they are rated: oldest first. */
export const ratedGames = (verdicts: Verdict[]) =>
  verdicts
    .filter((verdict) => verdict.rated && verdict.result !== "*")
    .sort((a, b) => a.endedAt - b.endedAt || a.addr.localeCompare(b.addr));

/**
 * Ratings per speed from audited rated games, each game its own rating period, oldest first.
 * As on Lichess, a human's rating moves half as far in a game against a bot; the bot's moves in full.
 */
export function ratings(verdicts: Verdict[], isBot: (pubkey: string) => boolean = () => false) {
  const table = new Map<string, Partial<Record<Speed, Rating>>>();
  for (const { players, result, speed } of ratedGames(verdicts)) {
    const before = players.map((player) => table.get(player)?.[speed] ?? START);
    const white = result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5;
    players.forEach((player, seat) => {
      const after = rate(before[seat], [
        { opponent: before[1 - seat], score: seat === 0 ? white : 1 - white },
      ]);
      if (isBot(players[1 - seat]) && !isBot(player)) after.r = (before[seat].r + after.r) / 2;
      table.set(player, { ...table.get(player), [speed]: after });
    });
  }
  return table;
}
