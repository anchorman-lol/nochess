import type { Settings } from "./settings.ts";

export type Sound = "move" | "capture" | "castle" | "check" | "low" | "end";
export const LOW_TIME_MS = 10_000;

/** The sound a move in SAN makes: mate ends the game, check beats capture and castling. */
export function soundFor(san: string): Sound {
  if (san.endsWith("#")) return "end";
  if (san.endsWith("+")) return "check";
  if (san.startsWith("O-O")) return "castle";
  return san.includes("x") ? "capture" : "move";
}

export const audible = ({ sound, volume }: Pick<Settings, "sound" | "volume">) =>
  sound && volume > 0;

/** True on the one tick where the running clock goes from above ten seconds to below. */
export const lowTimeCrossed = (beforeMs: number, nowMs: number) =>
  beforeMs > LOW_TIME_MS && nowMs <= LOW_TIME_MS;
