import { Chess, type Square } from "chess.js";
import type { Seat } from "@luft/core/game/replay.ts";

/** The board after `ply` of the moves, with the last move and a checked king to highlight. */
export function position(sans: string[], ply: number) {
  const chess = new Chess();
  const moves = sans.slice(0, ply).map((san) => chess.move(san));
  const last = moves.at(-1);
  const king = chess.inCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : null;
  return { fen: chess.fen(), last: last ? [last.from, last.to] : [], check: king ?? null };
}

/** Where the piece on `from` can go: legal moves on its side's turn, premoves otherwise. */
export function targets(fen: string, from: string, seat: Seat): string[] {
  const side = "wb"[seat];
  const fields = fen.split(" ");
  const premove = fields[1] !== side;
  if (premove) Object.assign(fields, { 1: side, 3: "-" });
  try {
    const chess = new Chess(fields.join(" "), { skipValidation: premove });
    if (chess.get(from as Square)?.color !== side) return [];
    return [...new Set(chess.moves({ square: from as Square, verbose: true }).map((m) => m.to))];
  } catch {
    return [];
  }
}

export function isPromotion(fen: string, from: string, to: string): boolean {
  const piece = new Chess(fen).get(from as Square);
  return piece?.type === "p" && to[1] === (piece.color === "w" ? "8" : "1");
}
