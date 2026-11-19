import { KIND } from "../game/events.ts";
import type { Zap } from "./zap.ts";

const forGame = (zap: Zap) => zap.addr?.startsWith(`${KIND.game}:`) ?? false;

/**
 * The receipt that pays for a challenge, among validated zaps to the bot: one of at least the
 * price that names this game, whoever paid it, or else one the challenger paid for another game
 * and the bot never used. `spent` holds the receipts the bot's joins already name.
 */
export function payment(
  zaps: Zap[],
  spent: Set<string>,
  want: { addr: string; payer: string; price: number },
): Zap | null {
  const unused = zaps.filter((zap) => forGame(zap) && zap.msat >= want.price && !spent.has(zap.id));
  return (
    unused.find((zap) => zap.addr === want.addr) ??
    unused.find((zap) => zap.from === want.payer) ??
    null
  );
}

/** The reviews a reviewer owes: one per receipt of at least its price that names a game and no label answers yet. */
export function owed(zaps: Zap[], answered: Set<string>, price: number): Zap[] {
  const open = zaps.filter((zap) => forGame(zap) && zap.msat >= price && !answered.has(zap.id));
  return [...new Map(open.map((zap) => [zap.id, zap])).values()];
}
