import { describe, expect, it } from "vitest";
import {
  type ChatLine,
  MAX_LENGTH,
  mayWrite,
  PHRASES,
  RATE,
  rateLimited,
  readable,
  roomsFor,
  shown,
} from "./rules.ts";

const WHITE = "a".repeat(64);
const BLACK = "b".repeat(64);
const WATCHER = "c".repeat(64);
const players = [WHITE, BLACK];
const line = (from: string, room: "players" | "spectators", text: string, at = 100): ChatLine => ({
  id: `${from}${text}${at}`,
  from,
  room,
  text,
  at,
});

describe("who writes what", () => {
  it("gives players free text in their room during the game and after it", () => {
    expect(mayWrite({ me: WHITE, players, phase: "playing", room: "players" }, "Good luck")).toBe(
      true,
    );
    expect(mayWrite({ me: WHITE, players, phase: "playing", room: "players" }, "lol")).toBe(true);
    expect(mayWrite({ me: WHITE, players, phase: "finished", room: "players" }, "lol")).toBe(true);
  });

  it("gives spectators free text in their own room and no voice in the players' room", () => {
    const watching = { me: WATCHER, players, phase: "playing" as const };
    expect(mayWrite({ ...watching, room: "spectators" }, "nice tactic")).toBe(true);
    expect(mayWrite({ ...watching, room: "players" }, "Hello")).toBe(false);
  });

  it("keeps players out of the spectator room during the game", () => {
    expect(mayWrite({ me: WHITE, players, phase: "playing", room: "spectators" }, "hi")).toBe(
      false,
    );
    expect(mayWrite({ me: WHITE, players, phase: "finished", room: "spectators" }, "hi")).toBe(
      true,
    );
  });

  it("refuses empty text and text over the cap", () => {
    const spectating = {
      me: WATCHER,
      players,
      phase: "playing" as const,
      room: "spectators" as const,
    };
    expect(mayWrite(spectating, "   ")).toBe(false);
    expect(mayWrite(spectating, "x".repeat(MAX_LENGTH))).toBe(true);
    expect(mayWrite(spectating, "x".repeat(MAX_LENGTH + 1))).toBe(false);
  });

  it("offers the five quick phrases as shortcuts", () => {
    expect(PHRASES).toEqual(["Hello", "Good luck", "Good game", "Well played", "Thanks"]);
  });
});

describe("what a reader sees", () => {
  it("shows players the players' room and, during the game, not the spectators'", () => {
    expect(roomsFor(WHITE, players, "playing")).toEqual(["players"]);
    expect(roomsFor(WHITE, players, "finished")).toEqual(["players", "spectators"]);
    expect(roomsFor(WATCHER, players, "playing")).toEqual(["spectators", "players"]);
  });

  it("drops lines in the players' room that aren't from a player, and keeps any a player wrote", () => {
    expect(readable(line(WATCHER, "players", "Hello"), players)).toBe(false);
    expect(readable(line(WHITE, "players", "Hello"), players)).toBe(true);
    expect(readable(line(WHITE, "players", "nice opening", 100), players)).toBe(true);
  });

  it("hides muted keys and keeps the order lines were written in", () => {
    const lines = [
      line(WATCHER, "spectators", "second", 20),
      line(BLACK, "spectators", "muted", 15),
      line(WHITE, "spectators", "first", 10),
    ];
    const result = shown(lines, {
      room: "spectators",
      players,
      muted: [BLACK],
    });
    expect(result.map((l) => l.text)).toEqual(["first", "second"]);
  });
});

describe("the rate limit", () => {
  it("waits a moment between lines and caps a burst", () => {
    const now = 1_000_000;
    expect(rateLimited([], now)).toBe(false);
    expect(rateLimited([now - RATE.gapMs + 1], now)).toBe(true);
    const burst = Array.from({ length: RATE.burst }, (_, i) => now - RATE.gapMs - i * 1000);
    expect(rateLimited(burst, now)).toBe(true);
    expect(rateLimited(burst.slice(1), now)).toBe(false);
  });
});
