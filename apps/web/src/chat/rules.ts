/** Rooms of a game's chat: the two players, and everyone watching. */
export type Room = "players" | "spectators";
export type Phase = "open" | "playing" | "finished";
export type ChatLine = { id: string; from: string; room: Room; text: string; at: number };

export const PHRASES = ["Hello", "Good luck", "Good game", "Well played", "Thanks"];
export const MAX_LENGTH = 280;
/** At least `gapMs` between lines, and at most `burst` lines in `windowMs`. */
export const RATE = { gapMs: 2000, burst: 5, windowMs: 30_000 };

const isPlayer = (pubkey: string, players: string[]) => players.includes(pubkey);

/** Players see the spectators only once the game is over; spectators read both rooms. */
export function roomsFor(me: string, players: string[], phase: Phase): Room[] {
  if (!isPlayer(me, players)) return ["spectators", "players"];
  return phase === "finished" ? ["players", "spectators"] : ["players"];
}

export function mayWrite(
  { me, players, phase, room }: { me: string; players: string[]; phase: Phase; room: Room },
  text: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return false;
  if (!roomsFor(me, players, phase).includes(room)) return false;
  return room === "spectators" || isPlayer(me, players);
}

/** A line counts if its author could have written it: only players speak in the players' room. */
export const readable = (line: ChatLine, players: string[]) =>
  line.room === "spectators" || isPlayer(line.from, players);

export const shown = (
  lines: ChatLine[],
  view: { room: Room; players: string[]; muted: string[] },
) =>
  lines
    .filter(
      (line) =>
        line.room === view.room && !view.muted.includes(line.from) && readable(line, view.players),
    )
    .sort((a, b) => a.at - b.at);

/** Whether a line sent now, after lines sent at `sent` (ms), would be too soon. */
export const rateLimited = (sent: number[], now: number) =>
  sent.some((at) => now - at < RATE.gapMs) ||
  sent.filter((at) => now - at < RATE.windowMs).length >= RATE.burst;
