import { expect, test } from "vitest";
import type { GameEvent } from "../game/events.ts";
import fixtures from "./fixtures.json" with { type: "json" };
import { jesterGames, START_REF } from "./jester.ts";

const recorded = jesterGames(fixtures);
const game = (id: string) => recorded.find((g) => g.id.startsWith(id))!;

test("recorded Amethyst games replay to their positions, newest activity first", () => {
  expect(recorded).toHaveLength(11);
  expect(recorded.map((g) => g.updatedAt)).toEqual(
    recorded.map((g) => g.updatedAt).toSorted((a, b) => b - a),
  );
  expect(game("d7f88d37")).toMatchObject({
    white: expect.stringMatching(/^ca89cb11/),
    black: expect.stringMatching(/^1aa25ae8/),
    sans: ["e4", "e5", "Bc4"],
    result: null,
  });
  expect(game("bbc782b5").sans).toEqual(["e4", "d6", "d3"]);
});

test("an open challenge has the challenger's colour and an empty seat", () => {
  expect(game("2ac0865f")).toMatchObject({
    white: expect.stringMatching(/^e587fa77/),
    black: null,
    sans: [],
    result: null,
  });
});

test("whoever makes an open seat's first move takes it, and an abandonment claim ends the game", () => {
  expect(game("4a320c73")).toMatchObject({
    white: expect.stringMatching(/^52af63b3/),
    black: expect.stringMatching(/^f8b6d9fe/),
    sans: ["d4"],
    result: "1-0",
    termination: "abandonment",
  });
});

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
let serial = 0;
function event(pubkey: string, content: object, e: string[], at: number): GameEvent {
  return {
    id: String(++serial).padStart(64, "0"),
    pubkey,
    kind: 30,
    created_at: at,
    tags: e.map((id) => ["e", id]),
    content: JSON.stringify({ version: "0", ...content }),
  };
}
/** A start by A as White and moves by A and B in turn, each naming the one before. */
function played(sans: string[], extra: (start: GameEvent) => GameEvent[] = () => []) {
  const start = event(A, { kind: 0, history: [], playerColor: "white" }, [START_REF], 100);
  const events = [start];
  sans.forEach((move, i) => {
    const history = sans.slice(0, i + 1);
    events.push(
      event(i % 2 ? B : A, { kind: 1, move, history }, [start.id, events.at(-1)!.id], 101 + i),
    );
  });
  return [...events, ...extra(start)];
}

test("only the seated players' moves count, each extending the line by one", () => {
  const events = played(["e4", "e5"], (start) => [
    event(C, { kind: 1, move: "Nf3", history: ["e4", "e5", "Nf3"] }, [start.id], 200),
    event(A, { kind: 1, move: "d4", history: ["d4"] }, [start.id], 201),
    event(A, { kind: 1, move: "Nc3", history: ["e4", "e6", "Nc3"] }, [start.id], 202),
  ]);
  expect(jesterGames(events)[0]).toMatchObject({ white: A, black: B, sans: ["e4", "e5"] });
});

test("the line stops at the first illegal move", () => {
  expect(jesterGames(played(["e4", "e5", "Ke3"]))[0].sans).toEqual(["e4", "e5"]);
});

test("a mate on the board ends the game whatever the events say", () => {
  expect(jesterGames(played(["f3", "e5", "g4", "Qh4#"]))[0]).toMatchObject({
    result: "0-1",
    termination: "checkmate",
  });
});

test("a resignation counts only when its author loses", () => {
  const resign = (who: string, result: string) => (start: GameEvent) => [
    event(
      who,
      { kind: 1, history: ["e4", "e5"], result, termination: "resignation" },
      [start.id],
      300,
    ),
  ];
  expect(jesterGames(played(["e4", "e5"], resign(A, "0-1")))[0]).toMatchObject({
    result: "0-1",
    termination: "resignation",
  });
  expect(jesterGames(played(["e4", "e5"], resign(A, "1-0")))[0].result).toBeNull();
});

test("a start that isn't from the standard position or isn't a start is skipped", () => {
  const odd = event(
    A,
    { kind: 0, history: [], fen: "8/8/8/8/8/8/8/K6k w - - 0 1" },
    [START_REF],
    1,
  );
  const chat = event(A, { kind: 2 }, [START_REF], 1);
  expect(jesterGames([odd, chat, { ...odd, content: "not json" }])).toEqual([]);
});
