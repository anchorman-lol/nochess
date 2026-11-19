import { describe, expect, it } from "vitest";
import { isPromotion, position, targets } from "./board.ts";

describe("position", () => {
  it("shows the position after a ply, its last move and a king in check", () => {
    const sans = ["f3", "e5", "g4", "Qh4#"];
    expect(position(sans, 4)).toMatchObject({ last: ["d8", "h4"], check: "e1" });
    expect(position(sans, 2)).toMatchObject({ last: ["e7", "e5"], check: null });
    expect(position(sans, 0).fen.split(" ")[0]).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  });
});

describe("targets", () => {
  const start = position([], 0).fen;
  it("lists the legal squares on the mover's turn", () => {
    expect(targets(start, "e2", 0).sort()).toEqual(["e3", "e4"]);
    expect(targets(start, "e7", 0)).toEqual([]);
  });
  it("lists premove squares while the opponent is to move", () => {
    expect(targets(start, "g8", 1).sort()).toEqual(["f6", "h6"]);
    expect(targets(start, "e1", 1)).toEqual([]);
  });
});

describe("isPromotion", () => {
  const fen = "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1";
  it("is a pawn move to the last rank", () => {
    expect(isPromotion(fen, "b7", "b8")).toBe(true);
    expect(isPromotion(fen, "e1", "e2")).toBe(false);
    expect(isPromotion(position([], 0).fen, "e2", "e4")).toBe(false);
  });
});
