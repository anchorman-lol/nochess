import { Icon, type IconName } from "@luft/ui/components/icon";
import { cn } from "cn";
import { m, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { type BoardModel, board as input, type Moves } from "../app/store.ts";
import { SIDES } from "../lib/format.ts";
import { Board } from "./board.tsx";
import { IconButton } from "./shell.tsx";

/**
 * The game layout: facts and chat on the left, the board as tall as the window, and a rail with
 * the opponent, the scoresheet, the controls and me. On a phone it stacks around the board.
 */
export function TableLayout({
  data,
  board,
  top,
  bottom,
  sheet,
  acts,
  slip,
}: {
  data: { seat: string; turn: string };
  board: BoardModel;
  top: ReactNode;
  bottom: ReactNode;
  sheet: ReactNode;
  acts: ReactNode;
  slip: ReactNode;
}) {
  return (
    <main
      data-testid="table"
      data-seat={data.seat}
      data-turn={data.turn}
      className="game mx-auto grid gap-x-5 px-0 md:my-5 md:px-5"
    >
      <div className="[grid-area:opp]">{top}</div>
      <div className="[grid-area:board]">
        <Board model={board} />
      </div>
      <div className="flex min-h-0 flex-col [grid-area:sheet] max-md:mx-3 max-md:mt-1">{sheet}</div>
      <div className="grid content-start gap-2 pt-2.5 [grid-area:acts] max-md:px-3">{acts}</div>
      <div className="[grid-area:me]">{bottom}</div>
      <aside className="flex min-h-0 flex-col gap-5 text-[0.92rem] [grid-area:slip] max-md:px-3 max-md:pt-6 max-md:pb-10">
        {slip}
      </aside>
    </main>
  );
}

export function SeatCard({
  seat,
  active,
  children,
  clock,
}: {
  seat: number;
  active: boolean;
  children: ReactNode;
  clock?: ReactNode;
}) {
  return (
    <div
      data-testid={`seat-${seat}`}
      data-active={active || undefined}
      className="player flex items-center gap-2.5 py-2 max-md:px-3"
    >
      <span
        title={SIDES[seat]}
        className={cn(
          "size-3 flex-none rounded-full border-[1.5px] border-foreground",
          seat ? "bg-foreground" : "bg-white",
        )}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2 leading-tight">{children}</span>
      {clock}
    </div>
  );
}

const NAV: [string, IconName, string][] = [
  ["first", "first", "First move"],
  ["prev", "prev", "Previous move"],
  ["next", "next", "Next move"],
  ["last", "last", "Last move"],
];

/** The move list as a ruled scoresheet, with the navigation in its header. */
export function Scoresheet({
  moves,
  result,
  empty,
}: {
  moves: Moves;
  result?: ReactNode;
  empty?: string;
}) {
  const { sans, ply } = moves;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const on = list.current?.querySelector<HTMLElement>("[data-on]");
    if (list.current && on)
      list.current.scrollTo({
        top: on.offsetTop - list.current.clientHeight / 2,
        left: on.offsetLeft - list.current.clientWidth / 2,
      });
  }, [ply, sans.length]);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[0.6rem] border border-line bg-background"
      aria-label="Scoresheet"
    >
      <nav
        className="flex items-center gap-0.5 border-b border-line bg-surface py-1 pr-1 pl-3"
        aria-label="Moves"
      >
        <span className="mr-auto text-[0.9rem] font-semibold">Scoresheet</span>
        <IconButton label="Flip the board (f)" testid="flip" onClick={() => input.flip()}>
          <Icon name="flip" />
        </IconButton>
        {NAV.map(([to, icon, label]) => (
          <IconButton
            key={to}
            label={label}
            disabled={to === "first" || to === "prev" ? ply === 0 : ply === sans.length}
            onClick={() => input.nav(to)}
          >
            <Icon name={icon} />
          </IconButton>
        ))}
      </nav>
      <ol
        ref={list}
        data-testid="moves"
        className="min-h-24 flex-1 overflow-y-auto tabular-nums max-md:flex max-md:min-h-0 max-md:overflow-x-auto max-md:[scrollbar-width:none]"
      >
        {Array.from({ length: Math.ceil(sans.length / 2) }, (_, i) => (
          <li
            key={i}
            className="grid grid-cols-[2.6rem_1fr_1fr] border-b border-line last:border-b-0 max-md:flex max-md:flex-none max-md:border-0"
          >
            <i className="border-r border-line bg-surface py-1.5 pr-2.5 text-right text-[0.87rem] text-muted-foreground not-italic max-md:border-0 max-md:bg-transparent max-md:pr-0.5 max-md:pl-2.5">
              {i + 1}
            </i>
            {[2 * i, 2 * i + 1].map((n) =>
              n < sans.length ? (
                <button
                  key={n}
                  type="button"
                  data-ply={n + 1}
                  data-on={n + 1 === ply || undefined}
                  onClick={() => input.nav("ply", n + 1)}
                  className="move px-3 py-1.5 text-left font-medium hover:bg-sunk data-[on]:bg-brand-soft data-[on]:font-bold data-[on]:text-brand data-[on]:shadow-[inset_0_-2px_0_var(--brand)] max-md:px-1.5"
                >
                  {sans[n]}
                </button>
              ) : (
                <span key={n} />
              ),
            )}
          </li>
        ))}
        {!sans.length && empty && (
          <li className="p-3 text-[0.9rem] text-muted-foreground">{empty}</li>
        )}
      </ol>
      {result}
    </section>
  );
}

export function Outcome({ score, text }: { score: string; text: string }) {
  return (
    <div
      className="result flex items-baseline gap-2.5 border-t border-line bg-surface px-3 py-2.5"
      data-testid="outcome"
    >
      {score && (
        <strong className="text-[1.35rem] leading-none font-extrabold tabular-nums">{score}</strong>
      )}{" "}
      <span className="font-semibold">{text}</span>
    </div>
  );
}

/** Two signatures on their lines: drawn once when the game ends, simply shown with reduced motion. */
const SIGNATURES = [
  "M4 46H22C34 46 48 31 48 19C48 12.5 44.5 9 39.5 9C34 9 30.5 14 30.5 22.5C30.5 36 37 46 48 46C56 46 58 34 64 34C69 34 67 46 74 46C82 46 82 30 90 30C96 30 93 46 102 46H146",
  "M4 46H14C22 46 30 12 40 12C48 12 44 46 36 46C30 46 34 28 46 28C56 28 50 46 60 46C68 46 70 34 78 34C86 34 82 46 92 46C100 46 104 38 112 40L146 46",
];
export function Signatures({ names, count }: { names: [ReactNode, ReactNode]; count: number }) {
  const reduced = useReducedMotion();
  return (
    <div className="@container grid gap-0.5 rounded-[0.6rem] border border-line px-3 pt-2 pb-2.5 text-[0.9rem]">
      {names.map((name, i) => {
        const signed = i < count;
        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] items-end gap-x-2 border-b border-line pt-1 pb-1 @min-[16rem]:grid-cols-[3.2rem_1fr_auto]"
          >
            <span className="text-muted-foreground">{SIDES[i]}</span>
            <svg
              viewBox="0 0 150 56"
              aria-hidden="true"
              className="order-last col-span-2 h-8 w-auto justify-self-start text-brand @min-[16rem]:order-none @min-[16rem]:col-span-1"
            >
              {signed && (
                <m.path
                  d={SIGNATURES[i]}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, delay: i * 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
            </svg>
            <span className="truncate text-right text-[0.85rem] font-semibold">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

export const btn =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-[0.55rem] border border-line bg-background px-3 font-semibold whitespace-nowrap transition-[background,border-color,transform] duration-150 hover:border-muted-foreground active:translate-y-px disabled:opacity-45 disabled:pointer-events-none";
export const btnPrimary =
  "border-brand bg-brand text-brand-ink hover:border-brand hover:bg-brand/90";
