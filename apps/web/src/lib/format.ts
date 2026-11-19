import { parseTc, speedOf } from "@luft/core/game/events.ts";
import { PROVISIONAL_RD, type Rating } from "@luft/core/game/glicko.ts";
import type { Zap } from "@luft/core/zap/zap.ts";
import * as nip19 from "nostr-tools/nip19";

export const SIDES = ["White", "Black"] as const;
export const TIME_CONTROLS = [
  "180+2",
  "300+0",
  "300+3",
  "600+0",
  "600+5",
  "900+10",
  "1800+0",
  "1d",
  "3d",
];

export const shortKey = (pubkey: string) => `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function tcLabel(tc: string): string {
  const clock = parseTc(tc);
  if (!clock) return tc;
  if ("days" in clock) return `${clock.days} day${clock.days > 1 ? "s" : ""} a move`;
  return `${clock.base / 60}+${clock.inc} ${speedOf(tc)}`;
}
export const terms = (tc: string, rated: boolean) =>
  `${tcLabel(tc)}, ${rated ? "rated" : "casual"}`;
export const provisional = ({ rd }: Rating) => rd >= PROVISIONAL_RD;
export const satsTo = (zaps: Zap[], pubkeys: string[]) =>
  zaps.reduce((sum, zap) => sum + (pubkeys.includes(zap.to) ? zap.msat : 0), 0) / 1000;
export const gameHref = (addr: string) => `#/${addr.split(":").slice(1).join("/")}`;
export const seekHref = (seek: { host: string; gameId: string }) => `#/${seek.host}/${seek.gameId}`;

export const outcomeText = (result: string, termination: string, noStart: number | null = null) =>
  noStart !== null
    ? `Game aborted: ${SIDES[noStart]} didn't make a first move in time`
    : result === "*"
      ? "Game aborted"
      : result === "1/2-1/2"
        ? `Draw by ${termination}`
        : `${SIDES[result === "1-0" ? 0 : 1]} wins by ${termination}`;

/** A clock face: days and hours, hours and minutes, or m:ss with tenths under ten seconds. */
export function clockText(ms: number, running: boolean): string {
  const left = Math.ceil(ms / 1000);
  if (left >= 86_400)
    return `${Math.floor(left / 86_400)} d ${Math.floor((left % 86_400) / 3600)} h`;
  if (left >= 3600) return `${Math.floor(left / 3600)} h ${Math.floor((left % 3600) / 60)} min`;
  if (running && ms < 10_000) return `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
