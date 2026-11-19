import type { Seat } from "@luft/core/game/replay.ts";
import { type ComputerModel, route } from "../app/store.ts";
import { Avatar } from "../components/common.tsx";
import {
  btn,
  btnPrimary,
  Outcome,
  Scoresheet,
  SeatCard,
  TableLayout,
} from "../components/table.tsx";
import { cn } from "cn";
import { SIDES } from "../lib/format.ts";

export function ComputerPage({ model }: { model: ComputerModel }) {
  const computer = (
    <SeatCard seat={1 - model.seat} active={model.thinking}>
      <span className="grid size-9 place-items-center rounded-full bg-foreground text-[0.7rem] font-bold text-background">
        SF
      </span>
      <span className="grid">
        <b className="font-semibold">
          <b className="bot mr-1 rounded-[0.25rem] bg-foreground px-1 text-[0.66rem] text-background">
            BOT
          </b>
          Stockfish
        </b>
        <span className="text-[0.87rem] text-muted-foreground">level {model.level}</span>
      </span>
    </SeatCard>
  );
  const you = (
    <SeatCard seat={model.seat} active={!model.thinking && !model.outcome}>
      <Avatar pubkey={"0".repeat(64)} size="lg" />
      <b className="font-semibold">You</b>
    </SeatCard>
  );
  const flipped = model.board.flipped;
  const [top, bottom] = flipped === (model.seat === 1) ? [computer, you] : [you, computer];
  return (
    <TableLayout
      data={{ seat: String(model.seat), turn: "" }}
      board={model.board}
      top={top}
      bottom={bottom}
      sheet={
        <Scoresheet moves={model.moves} result={model.outcome && <Outcome {...model.outcome} />} />
      }
      acts={
        <>
          {!model.outcome && (
            <p className="font-semibold" data-testid="status">
              {model.thinking ? "The computer is thinking…" : "Your move."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={cn(btn, btnPrimary)}
              data-testid="again"
              onClick={() => route?.act("again", {})}
            >
              New game
            </button>
            <button type="button" className={btn} onClick={() => route?.act("swap", {})}>
              Play {SIDES[(1 - model.seat) as Seat]}
            </button>
          </div>
        </>
      }
      slip={<p className="text-muted-foreground">Casual, in this browser. Nothing is published.</p>}
    />
  );
}
