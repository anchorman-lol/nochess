import { Chess } from "chess.js";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { expect, test } from "vitest";
import { archive, audit, auditAll, prove } from "./archive.ts";
import { type Action, address, build, type GameEvent, hashHex, type Template } from "./events.ts";
import { ratings, rate, START } from "./glicko.ts";
import { replay } from "./replay.ts";
import { labelFor, type Reviewed, summarise } from "./review.ts";

const keys = [0, 1, 2, 3].map(() => generateSecretKey());
const [HOST, , HS, GS] = keys.map((key) => getPublicKey(key));
const by = (who: number, template: Template): GameEvent => finalizeEvent(template, keys[who]);

/** A really signed game; the session key of whoever turns out to be White moves first. */
function signedGame(gameId: string, sans: string[], rated = true, endedBy?: Action) {
  const terms = { tc: "300+3", rated };
  const addr = address(HOST, gameId);
  const join = by(1, build.join(addr, HOST, terms, GS, hashHex("s"), 95));
  const events = [join, by(0, build.playing(gameId, terms, HS, "s", join, 100))];
  const white = replay(events, HOST, gameId).sessions![0] === HS ? 2 : 3;
  const chess = new Chess();
  let prev = join.id;
  sans.forEach((san, i) => {
    const { after } = chess.move(san);
    const move = by(i % 2 ? 5 - white : white, build.move(addr, i + 1, prev, san, after, 105 + i));
    prev = move.id;
    events.push(move);
  });
  if (endedBy) events.push(by(white, build.action(addr, sans.length, endedBy, 500)));
  return replay(events, HOST, gameId);
}
const MATE = ["f3", "e5", "g4", "Qh4#"];

test("an archive is a PGN that proves itself", () => {
  const game = signedGame("g1", MATE);
  const note = by(0, archive(game, "ws://relay", 600));
  expect(note.content).toContain('[Result "0-1"]');
  expect(note.content).toContain('[TimeControl "300+3"]');
  expect(note.content).toContain("1. f3 e5 2. g4 Qh4# 0-1");
  expect(prove(note)).toHaveLength(6);
  expect(audit([note])).toMatchObject({
    result: "0-1",
    termination: "checkmate",
    players: game.players,
    rated: true,
    speed: "blitz",
  });
});

test("an archive with a changed move or result proves nothing", () => {
  const note = by(0, archive(signedGame("g1", MATE), "ws://relay", 600));
  const forged = { ...note, content: note.content.replace(" e5 ", " e6 ") };
  expect(prove(forged)).toBeNull();
  expect(audit([forged])).toBeNull();
  const unfinished = { ...note, content: note.content.replace(" Qh4#", "") };
  expect(audit([unfinished])).toBeNull();
});

test("a resignation is proven by the resigner's signed action", () => {
  const note = by(1, archive(signedGame("g2", ["e4", "e5"], true, "resign"), "ws://relay", 600));
  expect(audit([note])).toMatchObject({ result: "0-1", termination: "resignation" });
});

test("an archive cut short loses to the full one", () => {
  const full = signedGame("g3", MATE);
  const cut = signedGame("g3", MATE.slice(0, 2), true, "resign");
  const loser = by(0, archive(cut, "ws://relay", 600));
  expect(audit([loser])?.termination).toBe("resignation");
  expect(audit([loser, by(1, archive(full, "ws://relay", 601))])?.termination).toBe("checkmate");
});

test("auditAll lists each game once, newest first", () => {
  const notes = [
    by(0, archive(signedGame("g1", MATE), "ws://relay", 600)),
    by(1, archive(signedGame("g1", MATE), "ws://relay", 601)),
    by(0, archive(signedGame("g4", ["e4", "e5"], false, "resign"), "ws://relay", 700)),
  ];
  expect(auditAll(notes).map((verdict) => verdict.termination)).toEqual([
    "resignation",
    "checkmate",
  ]);
});

test("Glicko-2 reproduces Glickman's worked example", () => {
  const opponent = (r: number, rd: number) => ({ r, rd, vol: 0.06, games: 0 });
  const after = rate(
    { r: 1500, rd: 200, vol: 0.06, games: 0 },
    [
      { opponent: opponent(1400, 30), score: 1 },
      { opponent: opponent(1550, 100), score: 0 },
      { opponent: opponent(1700, 300), score: 0 },
    ],
    0.5,
  );
  expect(after.r).toBeCloseTo(1464.06, 1);
  expect(after.rd).toBeCloseTo(151.52, 1);
  expect(after.vol).toBeCloseTo(0.05999, 4);
});

test("only rated games move ratings, and a bot moves a human half as far", () => {
  const rated = audit([by(0, archive(signedGame("g1", MATE), "ws://relay", 600))])!;
  const casual = audit([by(0, archive(signedGame("g5", MATE, false), "ws://relay", 600))])!;
  expect(ratings([casual]).size).toBe(0);
  const [white, black] = rated.players;
  const table = ratings([rated]);
  const won = table.get(black)!.blitz!;
  expect(won.r).toBeGreaterThan(START.r);
  expect(won.games).toBe(1);
  expect(table.get(white)!.blitz!.r).toBeLessThan(START.r);
  const vsBot = ratings([rated], (pubkey) => pubkey === white);
  expect(vsBot.get(black)!.blitz!.r - START.r).toBeCloseTo((won.r - START.r) / 2);
  expect(vsBot.get(white)!.blitz!.r).toBe(table.get(white)!.blitz!.r);
});

const move = (played: string, best: string, loss = 0, before = 30, forced = false): Reviewed => ({
  played,
  best,
  loss,
  before,
  forced,
});

test("the reviewer counts only moves that say something", () => {
  const opening = Array.from({ length: 10 }, () => move("e2e4", "e2e4"));
  const summary = summarise([
    ...opening,
    move("a2a3", "a2a3"),
    move("a2a3", "b2b3", 40),
    move("a2a3", "a2a3", 0, 30, true),
    move("a2a3", "a2a3", 0, 900),
  ]);
  expect(summary).toEqual({ positions: 2, matches: 1, matchRate: 0.5, acpl: 20 });
});

test("the reviewer flags only long, near-perfect engine agreement", () => {
  const opening = Array.from({ length: 10 }, () => move("e2e4", "e2e4"));
  const perfect = (n: number) => Array.from({ length: n }, () => move("a2a3", "a2a3", 2));
  expect(labelFor(summarise([...opening, ...perfect(30)]))).toBe("review-suggested");
  expect(labelFor(summarise([...opening, ...perfect(20)]))).toBe("analysed");
  const human = [...perfect(20), ...Array.from({ length: 10 }, () => move("a2a3", "b2b3", 60))];
  expect(labelFor(summarise([...opening, ...human]))).toBe("analysed");
});
