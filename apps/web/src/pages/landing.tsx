import { BRAND } from "@nochess/ui/brand";
import { Icon } from "@nochess/ui/components/icon";
import { Mark, Wordmark } from "@nochess/ui/components/logo";
import { cn } from "cn";
import { m, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { type LandingModel } from "../app/store.ts";
import { Board } from "../components/board.tsx";
import { Player, Signed } from "../components/common.tsx";
import { Signatures } from "../components/table.tsx";
import { position } from "../lib/board.ts";
import { gameHref, plural, seekHref, terms } from "../lib/format.ts";

/** Morphy's Opera Game, Paris 1858: seventeen moves, and every one of them worth watching. */
const OPERA =
  "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(
    " ",
  );
const STEP_MS = 1100;
const REST_MS = 6000;

const cta =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[0.65rem] px-6 text-[1.05rem] font-bold transition-[transform,background-color] duration-150 active:translate-y-px";

export function Landing({ model }: { model: LandingModel }) {
  return (
    <main>
      <Hero />
      <Idea />
      <Boards model={model} />
      <AroundTheBoard bots={model.bots.length} />
      <Close />
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[76rem] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-8 text-[0.92rem] text-muted-foreground">
          <span className="text-lg text-foreground">
            <Wordmark />
          </span>
          <span>
            Open code, no ads, no tracking. Rating rules and speed classes are Lichess's, with
            thanks.
          </span>
          <nav className="ml-auto flex gap-5 font-semibold text-foreground" aria-label="Footer">
            <a href="#/play" className="hover:text-brand">
              Play
            </a>
            <a href="#/settings" className="hover:text-brand">
              Settings
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

/**
 * The demo: the game plays itself onto a scoresheet, both sides sign, and after a rest it starts
 * again. With reduced motion it stands still on the signed final position.
 */
function useDemo(still: boolean) {
  const [ply, setPly] = useState(0);
  useEffect(() => {
    if (still) return;
    const timer = setTimeout(
      () => setPly((n) => (n >= OPERA.length ? 0 : n + 1)),
      ply >= OPERA.length ? REST_MS : ply === 0 ? 900 : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [ply, still]);
  return still ? OPERA.length : ply;
}

function Hero() {
  const reduced = useReducedMotion();
  const ply = useDemo(reduced === true);
  const { fen, last, check } = position(OPERA, ply);
  const done = ply >= OPERA.length;
  const rows = Array.from({ length: Math.ceil(OPERA.length / 2) }, (_, i) => i);
  return (
    <section className="relative overflow-hidden bg-brand text-white [--sq-light:oklch(0.93_0.03_262)] [--sq-dark:oklch(0.62_0.1_264)] dark:bg-[oklch(0.3_0.12_266)]">
      <Mark className="pointer-events-none absolute -right-24 -bottom-40 h-[38rem] w-auto text-white/[0.06] max-lg:hidden" />
      <div className="relative mx-auto grid max-w-[76rem] items-center gap-10 px-5 pt-12 pb-14 md:pt-16 md:pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <m.h1
            className="max-w-[12ch] text-[clamp(2.7rem,7vw,5.25rem)] leading-[0.98] font-extrabold tracking-[-0.035em] text-balance"
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            {BRAND.tagline}
          </m.h1>
          <p className="mt-6 max-w-[38ch] text-[clamp(1.1rem,1.6vw,1.3rem)] leading-[1.5] text-pretty text-[oklch(0.95_0.03_266)]">
            {BRAND.promise}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#/play"
              className={cn(
                cta,
                "bg-white text-[oklch(0.36_0.17_266)] hover:bg-[oklch(0.95_0.03_266)]",
              )}
              data-testid="cta-play"
            >
              Play now
            </a>
            <a
              href="#/about#how"
              data-testid="cta-how"
              className={cn(cta, "border border-white/40 text-white hover:bg-white/10")}
            >
              How signing works
            </a>
          </div>
          <p className="mt-6 text-[0.95rem] text-[oklch(0.9_0.05_266)]">
            No sign-up. Your browser makes a key and the game starts.
          </p>
        </div>
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_11.5rem]">
          <div
            className="rounded-lg shadow-[0_24px_60px_oklch(0.2_0.12_266/0.45)]"
            aria-label="A demonstration game: Morphy against the Duke of Brunswick and Count Isouard, Paris 1858"
            role="img"
          >
            <Board
              interactive={false}
              model={{
                fen,
                last,
                check,
                flipped: false,
                selected: null,
                targets: [],
                premove: [],
                promotion: null,
                dragging: null,
                ply,
                dropped: false,
              }}
            />
          </div>
          <div
            className="grid gap-3 rounded-lg bg-white p-3 text-foreground shadow-[0_24px_60px_oklch(0.2_0.12_266/0.35)] [color-scheme:light] max-sm:hidden"
            aria-hidden="true"
          >
            <div className="flex items-baseline justify-between border-b-2 border-[oklch(0.22_0.03_265)] pb-1 text-[oklch(0.22_0.03_265)]">
              <b className="text-[0.9rem]">Scoresheet</b>
              <span className="text-[0.75rem] text-[oklch(0.46_0.03_262)]">Paris 1858</span>
            </div>
            <ol className="grid grid-cols-[1.6rem_1fr_1fr] gap-x-1 text-[0.8rem] leading-[1.55] text-[oklch(0.22_0.03_265)] tabular-nums">
              {rows.map((i) => (
                <li key={i} className="contents">
                  <span className="text-right text-[oklch(0.46_0.03_262)]">{i + 1}.</span>
                  {[2 * i, 2 * i + 1].map((n) => (
                    <span
                      key={n}
                      className={cn(
                        "pl-1 transition-opacity duration-150",
                        n < ply ? "opacity-100" : "opacity-0",
                        n === ply - 1 &&
                          "rounded-sm bg-[oklch(0.45_0.19_266/0.12)] font-bold text-[oklch(0.45_0.19_266)]",
                      )}
                    >
                      {OPERA[n] ?? ""}
                    </span>
                  ))}
                </li>
              ))}
            </ol>
            <div className="text-[oklch(0.22_0.03_265)] [--brand:oklch(0.45_0.19_266)] [--line:oklch(0.895_0.01_258)] [--muted-foreground:oklch(0.46_0.03_262)]">
              <Signatures names={["Morphy", "Allies"]} count={done ? 2 : 0} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Idea() {
  const facts = [
    {
      icon: "flag" as const,
      title: "Every move is signed",
      text: "Your browser signs each move with a key for this game. Nobody can play one for you, and nobody can take one back.",
    },
    {
      icon: "check" as const,
      title: "Both players sign the result",
      text: "When it is over, the game becomes a scoresheet with two signatures, published where any app can read it.",
    },
    {
      icon: "eye" as const,
      title: "Anyone can check it",
      text: "Your browser replays every game it lists and checks every signature. Ratings are computed from games that hold up.",
    },
  ];
  return (
    <section id="how" className="scroll-mt-16">
      <div className="mx-auto grid max-w-[76rem] gap-12 px-5 py-20 md:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
        <div>
          <h2 className="max-w-[16ch] text-[clamp(2rem,4vw,3.2rem)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance">
            In a tournament hall, both players sign the scoresheet.
          </h2>
          <p className="mt-6 max-w-[48ch] text-[1.15rem] leading-[1.6] text-pretty text-muted-foreground">
            That sheet is the record. Nobody needs to trust the organiser to know what happened.{" "}
            {BRAND.name} works the same way, so your games, your rating and your name are yours to
            keep, here and in any other app that reads them.
          </p>
        </div>
        <ol className="grid content-start border-t border-line">
          {facts.map((fact) => (
            <li
              key={fact.title}
              className="grid grid-cols-[2.75rem_1fr] gap-x-4 border-b border-line py-6"
            >
              <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand">
                <Icon name={fact.icon} className="size-5" />
              </span>
              <div>
                <h3 className="text-[1.2rem] font-bold">{fact.title}</h3>
                <p className="mt-1 max-w-[52ch] text-muted-foreground">{fact.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Boards({ model }: { model: LandingModel }) {
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-[76rem] gap-10 px-5 py-20 md:grid-cols-2 md:gap-16">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[1.6rem] font-extrabold tracking-[-0.02em]">On the boards now</h2>
            <span className="flex items-center gap-2 text-[0.87rem] text-muted-foreground">
              <i
                className={cn(
                  "size-2 rounded-full",
                  model.online ? "bg-good" : "bg-muted-foreground",
                )}
              />
              {model.online ? "live from the relay" : "connecting…"}
            </span>
          </div>
          <ul className="mt-4 border-t border-line">
            {model.live.length ? (
              model.live.map((game) => (
                <li key={game.gameId} className="border-b border-line">
                  <a
                    href={seekHref(game)}
                    className="flex items-center gap-3 py-3 hover:text-brand"
                  >
                    <Icon name="eye" className="text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-semibold">
                      <Player pubkey={game.host} />{" "}
                      <span className="font-normal text-muted-foreground">vs</span>{" "}
                      <Player pubkey={game.guest} />
                    </span>
                    <span className="text-[0.87rem] text-muted-foreground">
                      {terms(game.tc, game.rated)}
                    </span>
                  </a>
                </li>
              ))
            ) : (
              <li className="border-b border-line py-3 text-muted-foreground">
                Quiet right now.{" "}
                <a href="#/play" className="font-semibold text-brand">
                  Open a seek
                </a>{" "}
                and the next game is yours.
              </li>
            )}
          </ul>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[1.6rem] font-extrabold tracking-[-0.02em]">Just finished</h2>
            {model.checked > 0 && (
              <Signed className="text-[0.87rem]">{plural(model.checked, "game")} checked</Signed>
            )}
          </div>
          <ul className="mt-4 border-t border-line">
            {model.results.length ? (
              model.results.map((v) => (
                <li key={v.addr} className="border-b border-line">
                  <a
                    href={gameHref(v.addr)}
                    className="flex items-center gap-3 py-3 hover:text-brand"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <Player pubkey={v.players[0]} />{" "}
                      <b className="mx-1 tabular-nums">{v.result.replaceAll("1/2", "½")}</b>{" "}
                      <Player pubkey={v.players[1]} />
                    </span>
                    <span className="text-[0.87rem] text-muted-foreground">{v.termination}</span>
                  </a>
                </li>
              ))
            ) : (
              <li className="border-b border-line py-3 text-muted-foreground">
                The first signed scoresheets will show here.
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function AroundTheBoard({ bots }: { bots: number }) {
  return (
    <section>
      <div className="mx-auto max-w-[76rem] px-5 py-20 md:py-28">
        <h2 className="max-w-[20ch] text-[clamp(1.8rem,3.4vw,2.6rem)] leading-[1.1] font-extrabold tracking-[-0.025em]">
          Around the board
        </h2>
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-16">
          <div className="rounded-2xl bg-zap-soft p-7 md:p-9">
            <Icon name="zap" className="size-9 text-zap" />
            <h3 className="mt-4 text-[1.6rem] font-extrabold tracking-[-0.02em]">
              Zap a good game
            </h3>
            <p className="mt-3 max-w-[46ch] text-[1.05rem] leading-[1.6]">
              A zap is a small bitcoin tip, sent straight to a player over Lightning. Zap the winner
              of a game you watched, or your opponent after a fine one. Never during your own game,
              and never as a pop-up.
            </p>
            <p className="mt-3 max-w-[46ch] text-muted-foreground">
              A share for the platform is shown before you pay, and you can set it to nothing.
            </p>
          </div>
          <dl className="grid content-start gap-8">
            <div>
              <dt className="flex items-center gap-2 text-[1.2rem] font-bold">
                <Icon name="bot" className="text-brand" />
                Bots to play
              </dt>
              <dd className="mt-1.5 max-w-[48ch] text-muted-foreground">
                Stockfish in your browser at eight levels, and bot accounts on the relay
                {bots ? ` (${bots} online now)` : ""}. Some bots ask a few sats a game and say so
                before you pay.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-[1.2rem] font-bold">
                <Icon name="scale" className="text-brand" />
                Reviewers that never accuse
              </dt>
              <dd className="mt-1.5 max-w-[48ch] text-muted-foreground">
                A fair-play reviewer measures how closely a game matched an engine and publishes
                what it found. The strongest thing it says is “worth a second look”, and you choose
                which reviewers you trust.
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-[1.2rem] font-bold">
                <Icon name="key" className="text-brand" />
                Your key, your record
              </dt>
              <dd className="mt-1.5 max-w-[48ch] text-muted-foreground">
                There are no accounts. Keep your key and you keep your games, your rating and your
                name, here and in every other Nostr app.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="bg-foreground text-background">
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-center gap-8 px-5 py-16 md:py-20">
        <Mark className="h-16 w-auto text-[var(--sq-light)]" />
        <h2 className="max-w-[22ch] min-w-[13ch] flex-1 text-[clamp(1.7rem,3.2vw,2.5rem)] leading-[1.1] font-extrabold tracking-[-0.025em] text-balance">
          Your key is your seat at the board.
        </h2>
        <a
          href="#/play"
          className={cn(
            cta,
            "bg-brand text-brand-ink hover:bg-brand/90 dark:bg-[oklch(0.45_0.19_266)] dark:text-white",
          )}
        >
          Play now
        </a>
      </div>
    </section>
  );
}
