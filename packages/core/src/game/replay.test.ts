import { expect, test } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  address,
  bindSession,
  build,
  firstMoveWindow,
  hashHex,
  sessionOf,
  speedOf,
} from "./events.ts";
import { replay } from "./replay.ts";
import { act, ADDR, BLITZ, GAME, GUEST, HOST, KEYS, play, seek, sign, started } from "./testkit.ts";

const run = (events: Parameters<typeof replay>[0]) => replay(events, HOST, GAME);

test("speed classes follow Lichess, and bullet has none", () => {
  expect(speedOf("60+0")).toBeNull();
  expect(speedOf("120+1")).toBeNull();
  expect(speedOf("180+0")).toBe("blitz");
  expect(speedOf("300+3")).toBe("blitz");
  expect(speedOf("480+0")).toBe("rapid");
  expect(speedOf("900+10")).toBe("rapid");
  expect(speedOf("1800+0")).toBe("classical");
  expect(speedOf("2d")).toBe("correspondence");
  expect(speedOf("0d")).toBeNull();
  expect(speedOf("fast")).toBeNull();
});

test("an open seek names the join the host should accept", () => {
  const [open, join] = seek();
  expect(run([open])).toMatchObject({ phase: "open", tc: "300+3", rated: true, join: null });
  expect(run([open, join]).join).toBe(join);
});

test("a join with other terms or another seed is not accepted", () => {
  expect(run(seek(BLITZ, "salt", { tc: "300+3", rated: false })).join).toBeNull();
  const [open, join] = seek();
  join.tags.find((tag) => tag[0] === "seed")![1] = hashHex("other");
  expect(run([open, join]).join).toBeNull();
});

test("a challenge only takes the challenged player", () => {
  const stranger = "e".repeat(64);
  const open = sign(HOST, build.open(GAME, BLITZ, KEYS[0], hashHex("salt"), 90, GUEST));
  const join = (who: string) =>
    sign(who, build.join(ADDR, HOST, BLITZ, KEYS[1], hashHex("salt"), 95));
  expect(run([open, join(stranger)]).join).toBeNull();
  expect(run([open, join(stranger), join(GUEST)]).join?.pubkey).toBe(GUEST);
});

test("no bullet game starts", () => {
  expect(run(seek({ tc: "60+0", rated: false })).phase).toBe("missing");
});

test("a started game seats the players by the revealed salt", () => {
  const game = run(started());
  expect(game).toMatchObject({ phase: "playing", players: [HOST, GUEST], sessions: KEYS });
  expect(game.deadline).toBeNull();
});

test("a salt that doesn't match the seed the guest joined starts nothing", () => {
  const [join, lobby] = started();
  lobby.tags.find((tag) => tag[0] === "salt")![1] = "swapped";
  expect(run([join, lobby]).phase).toBe("missing");
});

test("moves are replayed in chain order whatever order they arrive in", () => {
  const events = play(started(), ["e4", "e5", "Nf3"]);
  const game = run(events.toReversed());
  expect(game.sans).toEqual(["e4", "e5", "Nf3"]);
  expect(game.fen).toContain("5N2");
});

test("illegal moves, moves by the wrong key and moves off the chain are ignored", () => {
  const base = play(started(), ["e4"]);
  const [join] = base;
  const first = base.at(-1)!;
  const bad = [
    sign(KEYS[1], build.move(ADDR, 2, first.id, "Ke7", "x", 110)),
    sign(KEYS[0], build.move(ADDR, 2, first.id, "e5", "x", 110)),
    sign(KEYS[1], build.move(ADDR, 2, join.id, "e5", "x", 110)),
  ];
  expect(run([...base, ...bad]).sans).toEqual(["e4"]);
});

test("checkmate ends the game", () => {
  const game = run(play(started(), ["f3", "e5", "g4", "Qh4#"]));
  expect(game).toMatchObject({ phase: "finished", result: "0-1", termination: "checkmate" });
  expect(game.proof).toHaveLength(6);
});

test("the clock starts after both first moves and adds the increment", () => {
  const opened = run(play(started(), ["e4", "e5"], [120, 140]));
  expect(opened.clocks).toEqual([300, 300]);
  expect(opened.deadline).toBe(440);
  const game = run(play(started(), ["e4", "e5", "Nf3", "Nc6"], [120, 140, 150, 190]));
  expect(game.clocks).toEqual([293, 263]);
  expect(game.deadline).toBe(190 + 293);
});

test("a move after the flag fell loses on time", () => {
  const game = run(play(started(), ["e4", "e5", "Nf3"], [105, 110, 411]));
  expect(game).toMatchObject({ result: "0-1", termination: "time", sans: ["e4", "e5"] });
  expect(run(play(started(), ["e4", "e5", "Nf3"], [105, 110, 410])).result).toBeNull();
});

test("time can be claimed only once it has run out", () => {
  const events = play(started(), ["e4", "e5"], [105, 110]);
  expect(run([...events, act(1, 2, "claim-time", 410)]).result).toBeNull();
  expect(run([...events, act(1, 2, "claim-time", 411)])).toMatchObject({
    result: "0-1",
    termination: "time",
    endedAt: 410,
  });
  expect(run([...events, act(0, 2, "claim-time", 411)]).result).toBeNull();
});

test("a claim loses to a move that was made in time", () => {
  const events = play(started(), ["e4", "e5", "Nf3"], [105, 110, 300]);
  expect(run([...events, act(1, 2, "claim-time", 999)]).sans).toHaveLength(3);
});

test("correspondence gives every move its days, from the start", () => {
  const terms = { tc: "2d", rated: false };
  const begun = run(started(terms));
  expect(begun).toMatchObject({ startBy: 100 + 2 * 86_400, deadline: null });
  const game = run(play(started(terms), ["e4", "e5"], [5000, 6000]));
  expect(game.deadline).toBe(6000 + 2 * 86_400);
  const late = run([...started(terms), act(1, 0, "claim-time", 100 + 2 * 86_400 + 1)]);
  expect(late).toMatchObject({ result: "*", termination: "no start", noStart: 0 });
});

test("resigning loses, and before both have moved it aborts", () => {
  const events = play(started(), ["e4", "e5"]);
  expect(run([...events, act(0, 2, "resign", 120)])).toMatchObject({
    result: "0-1",
    termination: "resignation",
  });
  expect(run([...play(started(), ["e4"]), act(1, 1, "resign", 120)])).toMatchObject({
    result: "*",
    termination: "aborted",
  });
  expect(run([...events, act(0, 2, "abort", 120)]).result).toBeNull();
});

test("an ending written after its author played on is ignored", () => {
  const events = play(started(), ["e4", "e5", "Nf3", "Nc6"]);
  expect(run([...events, act(0, 1, "abort", 500)]).result).toBeNull();
  expect(run([...events, act(1, 2, "resign", 500)]).result).toBeNull();
});

test("a draw needs an offer the other side accepts before moving twice", () => {
  const events = play(started(), ["e4", "e5"]);
  const offer = act(0, 2, "draw-offer", 111);
  expect(run([...events, offer]).drawOffer).toBe(0);
  expect(run([...events, offer, act(1, 2, "draw-accept", 112)])).toMatchObject({
    result: "1/2-1/2",
    termination: "agreement",
  });
  expect(run([...events, act(1, 2, "draw-accept", 112)]).result).toBeNull();
  expect(run([...events, offer, act(0, 2, "draw-accept", 112)]).result).toBeNull();
  const later = play([...events, offer], ["Nf3", "Nc6"]);
  expect(run(later).drawOffer).toBeNull();
  expect(run([...later, act(1, 4, "draw-accept", 130)]).result).toBeNull();
});

test("an acceptance in the same second as the offer counts, whichever sorts first", () => {
  const events = play(started(), ["e4", "e5"]);
  const accept = act(1, 2, "draw-accept", 111);
  const offer = act(0, 2, "draw-offer", 111);
  expect(accept.id < offer.id).toBe(true);
  expect(run([...events, accept, offer]).result).toBe("1/2-1/2");
});

test("two different moves for one turn forfeit the game", () => {
  const events = play(started(), ["e4", "e5"]);
  const twice = [...play(events, ["Nf3"]), ...play(events, ["d4"])];
  expect(run(twice)).toMatchObject({ result: "0-1", termination: "equivocation" });
});

test("threefold repetition is a draw", () => {
  const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8"];
  const game = run(play(started(), [...shuffle, ...shuffle]));
  expect(game).toMatchObject({ result: "1/2-1/2", termination: "threefold repetition" });
});

test("a withdrawn seek is over: it takes no join, before or after", () => {
  const [open, join] = seek();
  const cancelled = sign(HOST, build.cancelled(GAME, BLITZ, 96));
  expect(run([open, join, cancelled])).toMatchObject({ phase: "cancelled", join: null });
  const late = sign(GUEST, build.join(ADDR, HOST, BLITZ, KEYS[1], hashHex("salt"), 97));
  expect(run([open, cancelled, late])).toMatchObject({ phase: "cancelled", join: null });
  expect(Number(cancelled.tags.find((tag) => tag[0] === "expiration")![1])).toBeGreaterThan(96);
});

test("each first move has Lichess's window: 25 s in blitz, 30 in rapid, 35 slower", () => {
  expect(firstMoveWindow("300+3")).toBe(25);
  expect(firstMoveWindow("900+10")).toBe(30);
  expect(firstMoveWindow("1800+0")).toBe(35);
  expect(firstMoveWindow("2d")).toBe(2 * 86_400);
  expect(run(started())).toMatchObject({ startBy: 125, deadline: null, noStart: null });
  expect(run(play(started(), ["e4"], [120])).startBy).toBe(145);
  expect(run(play(started(), ["e4", "e5"], [120, 140])).startBy).toBeNull();
});

test("a first move too late aborts the game, unrated, on the player who didn't move", () => {
  expect(run(play(started(), ["e4"], [125])).result).toBeNull();
  const white = run(play(started(), ["e4"], [126]));
  expect(white).toMatchObject({ result: "*", termination: "no start", noStart: 0, endedAt: 125 });
  expect(white.sans).toEqual([]);
  const black = run(play(started(), ["e4", "e5"], [110, 136]));
  expect(black).toMatchObject({ result: "*", termination: "no start", noStart: 1 });
});

test("after the window either side's claim or abort ends it on the one who didn't move", () => {
  const events = started();
  expect(run([...events, act(1, 0, "claim-time", 125)]).result).toBeNull();
  expect(run([...events, act(1, 0, "claim-time", 126)])).toMatchObject({ noStart: 0 });
  expect(run([...events, act(0, 0, "abort", 130)])).toMatchObject({ noStart: 0 });
  expect(run([...events, act(1, 0, "abort", 130)])).toMatchObject({ noStart: 0 });
  const early = run([...events, act(1, 0, "abort", 110)]);
  expect(early).toMatchObject({ result: "*", termination: "aborted", noStart: null });
});

test("a seek takes joins until it expires, and shows when that is", () => {
  const open = sign(HOST, build.open(GAME, BLITZ, KEYS[0], hashHex("salt"), 90, undefined, 60));
  const join = (at: number) =>
    sign(GUEST, build.join(ADDR, HOST, BLITZ, KEYS[1], hashHex("salt"), at));
  expect(run([open])).toMatchObject({ phase: "open", joinBy: 150 });
  expect(run([open, join(150)]).join).not.toBeNull();
  expect(run([open, join(151)]).join).toBeNull();
});

test("a challenge that expired or was declined says who didn't join", () => {
  const open = sign(HOST, build.open(GAME, BLITZ, KEYS[0], hashHex("salt"), 90, GUEST, 60));
  const expired = sign(
    HOST,
    build.cancelled(GAME, BLITZ, 151, { challenged: GUEST, reason: "expired" }),
  );
  expect(run([open, expired])).toMatchObject({
    phase: "cancelled",
    challenged: GUEST,
    ending: "expired",
  });
  expect(expired.tags.some((tag) => tag[0] === "expiration")).toBe(false);
  const no = sign(GUEST, build.decline(ADDR, HOST, "busy", 95));
  expect(run([open, no])).toMatchObject({ phase: "cancelled", ending: "declined: busy" });
  expect(run([open, sign("e".repeat(64), build.decline(ADDR, HOST, "busy", 95))]).phase).toBe(
    "open",
  );
});

test("a session key proves it agreed to play for this player in this game", () => {
  const secret = generateSecretKey();
  const template = build.join(ADDR, HOST, BLITZ, getPublicKey(secret), hashHex("salt"), 95);
  const bound = bindSession(template, secret, ADDR, GUEST);
  const [open] = seek();
  expect(sessionOf(sign(GUEST, bound), ADDR)).toBe(getPublicKey(secret));
  expect(run([open, sign(GUEST, bound)]).join?.pubkey).toBe(GUEST);
  expect(sessionOf(sign("e".repeat(64), bound), ADDR)).toBeNull();
  expect(run([open, sign("e".repeat(64), bound)]).join).toBeNull();
  expect(sessionOf(sign(GUEST, bound), address(HOST, "other"))).toBeNull();
});

test("a join from before session proofs still counts", () => {
  expect(run(seek()).join).not.toBeNull();
  expect(run(started()).phase).toBe("playing");
});

test("a join that names the host's session key is not accepted", () => {
  const [open] = seek();
  expect(
    run([open, sign(GUEST, build.join(ADDR, HOST, BLITZ, KEYS[0], hashHex("salt"), 95))]).join,
  ).toBeNull();
});
