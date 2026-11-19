import { m } from "motion/react";
import { useEffect, useRef } from "react";
import { type BoardModel, board as input, settings } from "../app/store.ts";

const FILES = "abcdefgh";
const PROMOTIONS = ["q", "n", "r", "b"];
const NAMES: Record<string, string> = { q: "queen", n: "knight", r: "rook", b: "bishop" };

export const pieceUrl = (code: string, set = settings.pieces) =>
  `${import.meta.env.BASE_URL}pieces/${set}/${code}.svg`;

type Square = { name: string; piece: string; dark: boolean };
function squaresOf(fen: string, flipped: boolean): Square[] {
  const squares = fen
    .split(" ")[0]
    .split("/")
    .flatMap((row, r) =>
      [...row]
        .flatMap((char) => (/\d/.test(char) ? Array<string>(Number(char)).fill("") : char))
        .map((piece, f) => ({ name: FILES[f] + (8 - r), piece, dark: (r + f) % 2 === 1 })),
    );
  return flipped ? squares.reverse() : squares;
}
const codeOf = (piece: string) =>
  `${piece === piece.toLowerCase() ? "b" : "w"}${piece.toUpperCase()}`;

/** Where a square sits on screen, in squares from the top left. */
function cell(name: string, flipped: boolean) {
  const x = FILES.indexOf(name[0]);
  const y = 8 - Number(name[1]);
  return flipped ? { x: 7 - x, y: 7 - y } : { x, y };
}

/**
 * The board, as buttons: a click or a drag moves, the keyboard selects with Enter. Pieces are
 * images of the chosen set; the last move's piece slides in unless it was dropped by hand.
 */
export function Board({
  model,
  interactive = true,
  mini = false,
}: {
  model: BoardModel;
  interactive?: boolean;
  mini?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const squares = squaresOf(model.fen, model.flipped);
  const [from, to] = model.last;
  const slide =
    from && to && !model.dropped
      ? { from: cell(from, model.flipped), to: cell(to, model.flipped) }
      : null;

  useEffect(() => {
    const element = ref.current;
    if (!element || !interactive) return;
    let drag: { x: number; y: number; ghost: HTMLElement | null; from: string } | null = null;
    const squareAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-square]")?.dataset.square ??
      null;
    const down = (event: PointerEvent) => {
      const square = (event.target as HTMLElement).closest<HTMLElement>("[data-square]");
      if (
        !square ||
        event.button !== 0 ||
        (event.target as HTMLElement).closest("[data-promotion]")
      )
        return;
      event.preventDefault();
      if (input.press(square.dataset.square!))
        drag = { x: event.clientX, y: event.clientY, ghost: null, from: square.dataset.square! };
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
        const origin = element.querySelector<HTMLElement>(`[data-square="${drag.from}"]`);
        const piece = origin?.querySelector("img");
        if (!origin || !piece) return void (drag = null);
        drag.ghost = Object.assign(document.createElement("img"), { src: piece.src, alt: "" });
        drag.ghost.className = "pointer-events-none fixed top-0 left-0 z-50 drop-shadow-lg";
        drag.ghost.style.width = drag.ghost.style.height = `${origin.offsetWidth}px`;
        document.body.append(drag.ghost);
        input.lift();
      }
      const size = drag.ghost.offsetWidth;
      drag.ghost.style.translate = `${event.clientX - size / 2}px ${event.clientY - size / 2}px`;
      const over = squareAt(event.clientX, event.clientY);
      for (const square of element.querySelectorAll("[data-over]"))
        if ((square as HTMLElement).dataset.square !== over) square.removeAttribute("data-over");
      if (over) element.querySelector(`[data-square="${over}"]`)?.setAttribute("data-over", "");
    };
    const up = (event: PointerEvent) => {
      if (!drag) return;
      const { ghost } = drag;
      drag = null;
      ghost?.remove();
      for (const square of element.querySelectorAll("[data-over]"))
        square.removeAttribute("data-over");
      input.release(ghost ? squareAt(event.clientX, event.clientY) : null);
    };
    const cancel = () => {
      drag?.ghost?.remove();
      drag = null;
      input.cancel();
    };
    element.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      element.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      drag?.ghost?.remove();
    };
  }, [interactive]);

  return (
    <div
      ref={ref}
      className="board"
      data-mini={mini || undefined}
      data-testid={mini ? undefined : "board"}
      data-fen={model.fen}
    >
      {squares.map(({ name, piece, dark }, i) => {
        const target = model.targets.includes(name);
        const classes = [
          "sq",
          dark ? "dark" : "light",
          name === model.selected && "sel",
          target && (piece ? "target capture" : "target"),
          model.last.includes(name) && "last",
          model.premove.includes(name) && "pre",
          name === model.check && "check",
        ];
        const side = piece === piece.toLowerCase() ? "black" : "white";
        const sliding = slide && name === to && piece;
        const image = piece && (
          <img
            alt=""
            draggable={false}
            src={pieceUrl(codeOf(piece))}
            className="piece"
            data-lifted={name === model.dragging || undefined}
          />
        );
        const Cell = interactive ? "button" : "div";
        return (
          <Cell
            key={name}
            className={classes.filter(Boolean).join(" ")}
            data-square={name}
            data-testid={mini ? undefined : `sq-${name}`}
            aria-label={`${name}${piece ? ` ${side} ${piece.toLowerCase()}` : ""}`}
            onClick={
              interactive
                ? (event) => {
                    if (event.detail === 0) input.click(name);
                  }
                : undefined
            }
          >
            {!mini && i % 8 === 0 && <span className="coord rank">{name[1]}</span>}
            {!mini && i >= 56 && <span className="coord file">{name[0]}</span>}
            {sliding ? (
              <m.span
                key={`${name}-${model.ply}`}
                className="absolute inset-0"
                initial={{
                  x: `${(slide.from.x - slide.to.x) * 100}%`,
                  y: `${(slide.from.y - slide.to.y) * 100}%`,
                }}
                animate={{ x: 0, y: 0 }}
                transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
              >
                {image}
              </m.span>
            ) : (
              image
            )}
          </Cell>
        );
      })}
      {model.promotion && <Promotion {...model.promotion} flipped={model.flipped} />}
    </div>
  );
}

function Promotion({
  square,
  color,
  flipped,
}: {
  square: string;
  color: string;
  flipped: boolean;
}) {
  const file = FILES.indexOf(square[0]);
  const column = flipped ? 7 - file : file;
  const top = (square[1] === "8") !== flipped;
  return (
    <div
      className="absolute inset-0 z-10 bg-foreground/35"
      data-testid="promotion"
      data-promotion
      onClick={(event) => event.target === event.currentTarget && input.promote(null)}
    >
      <div
        className="absolute flex w-[12.5%] flex-col overflow-hidden rounded-md bg-background shadow-lift"
        style={{
          left: `${column * 12.5}%`,
          ...(top ? { top: 0 } : { bottom: 0 }),
          flexDirection: top ? "column" : "column-reverse",
        }}
      >
        {PROMOTIONS.map((p) => (
          <button
            key={p}
            className="aspect-square hover:bg-brand-soft"
            data-testid={`promote-${p}`}
            aria-label={`Promote to ${NAMES[p]}`}
            onClick={() => input.promote(p)}
          >
            <img alt="" src={pieceUrl(`${color}${p.toUpperCase()}`)} className="size-full p-[6%]" />
          </button>
        ))}
      </div>
    </div>
  );
}
