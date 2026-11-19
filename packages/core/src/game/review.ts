/** One move of the reviewed player, as an engine saw it. Evaluations are centipawns for the mover. */
export type Reviewed = {
  played: string;
  best: string;
  /** The position's evaluation before the move, and how much of it the move gave away. */
  before: number;
  loss: number;
  /** The only legal move. */
  forced: boolean;
};
export type Summary = { positions: number; matches: number; matchRate: number; acpl: number };

export const LABELS = { clear: "analysed", flag: "review-suggested" } as const;
/** Deliberately hard to reach: a flag asks a human to look, it accuses nobody. */
export const THRESHOLD = { positions: 25, matchRate: 0.85, acpl: 12 };
const OPENING_MOVES = 10;
const DECIDED = 600;

/**
 * Engine agreement over the moves that say something: not the first ten (theory), not forced
 * ones, and not those in positions already won or lost, where many moves are as good as the best.
 */
export function summarise(moves: Reviewed[]): Summary {
  const counted = moves
    .slice(OPENING_MOVES)
    .filter((move) => !move.forced && Math.abs(move.before) <= DECIDED);
  const matches = counted.filter((move) => move.played === move.best).length;
  const positions = counted.length;
  return {
    positions,
    matches,
    matchRate: positions ? matches / positions : 0,
    acpl: positions
      ? counted.reduce((sum, move) => sum + Math.max(0, move.loss), 0) / positions
      : 0,
  };
}

export const labelFor = ({ positions, matchRate, acpl }: Summary) =>
  positions >= THRESHOLD.positions && matchRate >= THRESHOLD.matchRate && acpl <= THRESHOLD.acpl
    ? LABELS.flag
    : LABELS.clear;
