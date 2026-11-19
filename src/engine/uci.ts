/** A line-based connection to a UCI engine: a Web Worker in the browser, a process in Node. */
export type Pipe = {
  post(line: string): void;
  listen(onLine: (line: string) => void): void;
  close(): void;
};
/** The best move in UCI notation and the evaluation in centipawns for the side to move. */
export type Found = { best: string; cp: number };

/** Lichess-style levels 1 to 8: Stockfish's skill setting and the time it gets per move. */
export const LEVELS = [
  { skill: 0, ms: 50 },
  { skill: 3, ms: 100 },
  { skill: 6, ms: 150 },
  { skill: 9, ms: 200 },
  { skill: 12, ms: 300 },
  { skill: 15, ms: 400 },
  { skill: 18, ms: 700 },
  { skill: 20, ms: 1000 },
];
export const ENGINE = "Stockfish 19 lite (WASM, one thread)";
const MATE = 1000;

export class Engine {
  private pipe: Pipe;
  private cp = 0;
  private done?: (found: Found) => void;

  constructor(pipe: Pipe, skill = 20) {
    this.pipe = pipe;
    pipe.listen((line) => this.read(line));
    pipe.post("uci");
    pipe.post(`setoption name Skill Level value ${skill}`);
  }

  private read(line: string) {
    const score = line.match(/^info .*score (cp|mate) (-?\d+)/);
    if (score) {
      const value = Number(score[2]);
      this.cp =
        score[1] === "mate" ? Math.sign(value) * MATE : Math.max(-MATE, Math.min(MATE, value));
    }
    const best = line.match(/^bestmove (\S+)/);
    if (best) this.done?.({ best: best[1], cp: this.cp });
  }

  /** Searches one position, e.g. with `movetime 200` or `depth 12`. One search at a time. */
  go(fen: string, limit: string): Promise<Found> {
    return new Promise((resolve) => {
      this.cp = 0;
      this.done = resolve;
      this.pipe.post(`position fen ${fen}`);
      this.pipe.post(`go ${limit}`);
    });
  }

  close() {
    this.pipe.close();
  }
}

export function workerPipe(url: string): Pipe {
  const worker = new Worker(url);
  return {
    post: (line) => worker.postMessage(line),
    listen: (onLine) => (worker.onmessage = (message) => onLine(String(message.data))),
    close: () => worker.terminate(),
  };
}
