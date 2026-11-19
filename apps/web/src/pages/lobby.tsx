import { parseTc, speedOf } from "@luft/core/game/events.ts";
import type { Verdict } from "@luft/core/game/archive.ts";
import { Icon } from "@luft/ui/components/icon";
import { cn } from "cn";
import * as nip19 from "nostr-tools/nip19";
import { type FormEvent, type ReactNode, useState } from "react";
import { type LobbyModel, me, route, source, who } from "../app/store.ts";
import {
  Hint,
  List,
  None,
  Player,
  PlayerLink,
  RatingOf,
  Section,
  Signed,
} from "../components/common.tsx";
import {
  gameHref,
  plural,
  seekHref,
  shortKey,
  showRating,
  tcLabel,
  terms,
  TIME_CONTROLS,
} from "../lib/format.ts";

const ROWS = [
  { speed: "Blitz", note: "3 to 8 minutes", tcs: ["180+2", "300+0", "300+3"] },
  { speed: "Rapid", note: "8 to 25 minutes", tcs: ["600+0", "600+5", "900+10"] },
  { speed: "Classical", note: "25 minutes and up", tcs: ["1800+0"] },
  { speed: "By post", note: "days a move", tcs: ["1d", "3d"] },
];
const lobbyRoute = () => (route?.name === "lobby" ? route : null);
const act = (action: string, data: Record<string, string> = {}) => lobbyRoute()?.act(action, data);
const submit = (form: string) => (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const [value] = new FormData(event.currentTarget).values();
  lobbyRoute()?.submit(form, String(value ?? "").trim());
};
const change = (name: string, value: string | boolean) => lobbyRoute()?.change(name, value);

export const button =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-[0.55rem] border border-line bg-background px-3.5 font-semibold whitespace-nowrap transition-[background,border-color,transform] duration-150 hover:border-muted-foreground active:translate-y-px disabled:opacity-45 disabled:pointer-events-none";
export const primary = "border-brand bg-brand text-brand-ink hover:border-brand hover:bg-brand/90";
export const input =
  "h-10 w-full min-w-0 rounded-[0.55rem] border border-line bg-background px-3 text-foreground placeholder:text-muted-foreground";

export function Lobby({ model }: { model: LobbyModel }) {
  return (
    <main className="mx-auto grid max-w-[76rem] gap-10 px-3 pt-5 pb-16 md:px-5 md:pt-7 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="grid min-w-0 content-start gap-9">
        <Pairing model={model} />
        <Seeks model={model} />
        <Live model={model} />
        <Results model={model} />
      </div>
      <aside className="grid min-w-0 content-start gap-9">
        <StartPanel model={model} />
        <Bots model={model} />
        <Ranks model={model} />
        <You model={model} />
      </aside>
    </main>
  );
}

function Pairing({ model }: { model: LobbyModel }) {
  const cell = (tc: string) => {
    const clock = parseTc(tc)!;
    const time = "days" in clock ? plural(clock.days, "day") : `${clock.base / 60}+${clock.inc}`;
    const waiting = model.seeks.filter((s) => s.tc === tc && !s.mine && !s.forMe).length;
    const mine = model.seeks.find((s) => s.tc === tc && s.mine && !s.guest);
    const base =
      "flex flex-1 items-baseline justify-center gap-2 border-r border-line px-2 py-4 last:border-r-0 transition-colors duration-150 max-sm:flex-col max-sm:items-center max-sm:gap-0.5 max-sm:py-3";
    if (mine || model.pending === tc)
      return (
        <button
          key={tc}
          type="button"
          className={cn(base, "bg-brand-soft")}
          data-tc={tc}
          data-testid="seeking"
          onClick={() => act("cancel-seek", { game: mine?.gameId ?? "" })}
        >
          <b className="text-[1.35rem] leading-none font-semibold tracking-[-0.01em] tabular-nums">
            {time}
          </b>
          <span className="text-[0.82rem] font-semibold text-brand">
            Seeking… <u>Cancel</u>
          </span>
        </button>
      );
    return (
      <button
        key={tc}
        type="button"
        className={cn(base, "hover:bg-brand-soft", tc === model.tc && "bg-surface")}
        data-tc={tc}
        onClick={() => act("quick", { tc })}
      >
        <b className="text-[1.35rem] leading-none font-semibold tracking-[-0.01em] tabular-nums">
          {time}
        </b>
        {waiting > 0 && (
          <span className="text-[0.82rem] font-semibold text-brand">
            {plural(waiting, "player")} waiting
          </span>
        )}
      </button>
    );
  };
  return (
    <section aria-labelledby="quick">
      <div className="mb-3 flex items-center gap-3">
        <h1
          id="quick"
          className="mr-auto text-[1.6rem] leading-tight font-extrabold tracking-[-0.02em]"
        >
          Quick pairing
        </h1>
        <Toggle name="rated" checked={model.rated} onChange={(on) => change("rated", on)}>
          Rated
        </Toggle>
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        {ROWS.map((row) => (
          <div
            key={row.speed}
            className="grid border-b border-line last:border-b-0 sm:grid-cols-[8.5rem_1fr]"
          >
            <div className="flex items-baseline justify-between border-b border-line bg-surface px-3 py-1.5 sm:flex-col sm:justify-center sm:border-r sm:border-b-0 sm:px-4 sm:py-3">
              <b className="font-bold">{row.speed}</b>
              <small className="text-[0.82rem] text-muted-foreground">{row.note}</small>
            </div>
            <div className="flex">{row.tcs.map(cell)}</div>
          </div>
        ))}
      </div>
      <Hint className="mt-2.5">
        A time joins a player already waiting for that game, or opens a seek for others to find.
      </Hint>
    </section>
  );
}

function Toggle({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 font-semibold select-none">
      <span className="relative inline-flex">
        <input
          type="checkbox"
          name={name}
          data-testid={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
        />
        <span className="relative h-6 w-10 rounded-full bg-line transition-colors duration-150 peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-150 peer-checked:after:translate-x-4" />
      </span>
      {children}
    </label>
  );
}

function Seeks({ model }: { model: LobbyModel }) {
  const others = model.seeks.filter((seek) => !seek.mine);
  return (
    <Section title="Open seeks">
      <List data-testid="my-seeks" className="border-t-0">
        {model.seeks
          .filter((seek) => seek.mine)
          .map((seek) => (
            <li key={seek.gameId} className="first:border-t first:border-line">
              <a href={seekHref(seek)} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="font-semibold">
                  Your{" "}
                  {seek.guest ? (
                    <>
                      challenge to <Player pubkey={seek.guest} />
                    </>
                  ) : (
                    "seek"
                  )}
                  , waiting…
                </span>
                <span className="text-[0.9rem] text-muted-foreground">
                  {terms(seek.tc, seek.rated)}
                </span>
              </a>
              <button
                type="button"
                className={cn(button, "h-8 text-[0.87rem]")}
                data-testid="cancel-seek"
                onClick={() => act("cancel-seek", { game: seek.gameId })}
              >
                Cancel
              </button>
            </li>
          ))}
      </List>
      <List data-testid="seeks">
        {others.length ? (
          others.map((seek) => (
            <li key={seek.gameId}>
              <a
                href={seekHref(seek)}
                className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold">
                  <Player pubkey={seek.host} />
                  <RatingOf pubkey={seek.host} speed={speedOf(seek.tc)} />
                </span>
                <span className="text-[0.9rem] text-muted-foreground tabular-nums">
                  {tcLabel(seek.tc)}
                </span>
                <span className="w-24 text-right text-[0.9rem] text-muted-foreground">
                  {seek.forMe ? "challenges you" : seek.rated ? "rated" : "casual"}
                </span>
              </a>
            </li>
          ))
        ) : (
          <None>Nobody is waiting. Pick a time to open a seek.</None>
        )}
      </List>
    </Section>
  );
}

function Live({ model }: { model: LobbyModel }) {
  return (
    <Section title="On the boards">
      <List data-testid="live">
        {model.live.length ? (
          model.live.map((game) => (
            <li key={game.gameId}>
              <a
                href={seekHref(game)}
                className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand"
              >
                <Icon name="eye" className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  <Player pubkey={game.host} />{" "}
                  <i className="font-normal text-muted-foreground not-italic">vs</i>{" "}
                  <Player pubkey={game.guest} />
                </span>
                <span className="text-[0.9rem] text-muted-foreground max-sm:hidden">
                  {terms(game.tc, game.rated)}
                </span>
              </a>
            </li>
          ))
        ) : (
          <None>No game is running.</None>
        )}
      </List>
    </Section>
  );
}

export function ResultRow({ verdict }: { verdict: Verdict }) {
  return (
    <li>
      <a
        href={gameHref(verdict.addr)}
        className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand"
      >
        <span className="min-w-0 flex-1 truncate">
          <Player pubkey={verdict.players[0]} />{" "}
          <b className="mx-1 inline-block min-w-9 text-center tabular-nums">
            {verdict.result.replaceAll("1/2", "½")}
          </b>{" "}
          <Player pubkey={verdict.players[1]} />
        </span>
        <span className="text-[0.87rem] text-muted-foreground max-sm:hidden">
          {verdict.termination} · {terms(verdict.tc, verdict.rated)}
        </span>
      </a>
    </li>
  );
}

function Results({ model }: { model: LobbyModel }) {
  return (
    <Section
      title="Recent games"
      aside={
        !model.checking &&
        model.results.length > 0 && <Signed className="text-[0.87rem]">Signed and checked</Signed>
      }
    >
      <Hint className="mb-2" data-testid="audit">
        {model.checking
          ? "Checking signatures…"
          : `${plural(model.results.length, "game")} checked out: both players signed every move, and each game replays to its result.${
              model.doubted
                ? ` ${plural(model.doubted, "scoresheet")} did not check out and ${model.doubted === 1 ? "is" : "are"} not listed.`
                : ""
            }`}
      </Hint>
      <List data-testid="results">
        {model.results.map((verdict) => (
          <ResultRow key={verdict.addr} verdict={verdict} />
        ))}
      </List>
    </Section>
  );
}

function StartPanel({ model }: { model: LobbyModel }) {
  const [tab, setTab] = useState<"custom" | "friend" | "computer">("custom");
  const tabs = [
    ["custom", "Custom"],
    ["friend", "Friend"],
    ["computer", "Computer"],
  ] as const;
  const options = [...new Set([...TIME_CONTROLS, model.tc])];
  return (
    <section className="overflow-hidden rounded-xl border border-line" aria-label="Start a game">
      <div role="tablist" className="grid grid-cols-3 border-b border-line bg-surface">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="h-10 text-[0.9rem] font-semibold text-muted-foreground shadow-[inset_0_-2px_0_transparent] aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-[inset_0_-2px_0_var(--brand)]"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 p-4" role="tabpanel">
        {tab === "custom" && (
          <>
            <label className="grid gap-1 text-[0.87rem] font-semibold">
              Time control
              <select
                name="tc"
                data-testid="tc"
                value={model.tc}
                onChange={(event) => change("tc", event.target.value)}
                className={input}
              >
                {options.map((tc) => (
                  <option key={tc} value={tc}>
                    {tcLabel(tc)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={cn(button, primary)}
              data-testid="create"
              onClick={() => act("create")}
            >
              Create a game
            </button>
            <Hint>
              {model.rated ? "Rated" : "Casual"}, with a link to send. It also shows in the lobby.
            </Hint>
          </>
        )}
        {tab === "friend" && (
          <form className="grid gap-3" onSubmit={submit("challenge")}>
            <label className="grid gap-1 text-[0.87rem] font-semibold">
              Their key
              <input
                name="npub"
                placeholder="npub1…"
                aria-label="Player to challenge"
                className={input}
              />
            </label>
            <button className={cn(button, primary)}>Challenge</button>
            <Hint>Or create a game and send its link.</Hint>
          </form>
        )}
        {tab === "computer" && (
          <>
            <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label="Level">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input
                    type="radio"
                    name="level"
                    value={n}
                    data-testid={`level-${n}`}
                    checked={n === model.level}
                    onChange={() => change("level", String(n))}
                    className="peer sr-only"
                  />
                  <span className="grid h-9 place-items-center rounded-md border border-line font-semibold tabular-nums peer-checked:border-brand peer-checked:bg-brand peer-checked:text-brand-ink peer-focus-visible:outline-2 peer-focus-visible:outline-brand">
                    {n}
                  </span>
                </label>
              ))}
            </div>
            <a
              className={cn(button, primary)}
              href={`#/computer/${model.level}`}
              data-testid="computer"
            >
              Play level {model.level}
            </a>
            <Hint>Stockfish in this browser. Casual, and nothing is published.</Hint>
          </>
        )}
        {model.error && (
          <p className="text-[0.9rem] text-bad" data-testid="error">
            {model.error}
          </p>
        )}
      </div>
    </section>
  );
}

function Bots({ model }: { model: LobbyModel }) {
  return (
    <Section title="Bot accounts">
      <List data-testid="bots">
        {model.bots.length ? (
          model.bots.map((bot) => (
            <li key={bot.pubkey}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <PlayerLink pubkey={bot.pubkey} />
                {bot.rating && (
                  <span className="rating text-muted-foreground tabular-nums">
                    {showRating(bot.rating)}
                  </span>
                )}
              </span>
              <button
                type="button"
                className={cn(button, "h-8 text-[0.87rem]")}
                data-testid="challenge-bot"
                disabled={!bot.plays}
                title={
                  bot.plays
                    ? `Challenge to ${terms(model.tc, model.rated)}`
                    : `Doesn't play ${terms(model.tc, model.rated)}`
                }
                onClick={() => act("challenge-bot", { pubkey: bot.pubkey })}
              >
                Challenge{bot.sats ? ` · ${plural(bot.sats, "sat")}` : ""}
              </button>
            </li>
          ))
        ) : (
          <None>No bot account is online on this relay.</None>
        )}
      </List>
      <Hint className="mt-2">
        {terms(model.tc, model.rated)}. A human's rating moves half as far against a bot. A bot that
        names a price joins once you have paid it.
      </Hint>
    </Section>
  );
}

function Ranks({ model }: { model: LobbyModel }) {
  return (
    <Section title="Leaderboard">
      <ol data-testid="ranks" className="border-t border-line">
        {model.ranks.length ? (
          model.ranks.map(({ pubkey, speed, rating }, i) => (
            <li
              key={`${pubkey}-${speed}`}
              className="flex min-h-11 items-center gap-3 border-b border-line py-1.5"
            >
              <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                <PlayerLink pubkey={pubkey} />
              </span>
              <span className="text-[0.87rem] text-muted-foreground">
                {speed} · {plural(rating.games, "game")}
              </span>
              <b className="rating tabular-nums">{showRating(rating)}</b>
            </li>
          ))
        ) : (
          <li className="flex min-h-11 items-center border-b border-line text-[0.9rem] text-muted-foreground">
            No rated game yet.
          </li>
        )}
      </ol>
      <Hint className="mt-2" data-testid="rating-source">
        Glicko-2,{" "}
        {model.trusted
          ? "as published by the trusted rater, and computed in your browser for players it has not rated yet. A player's page recomputes their rating to verify it"
          : "computed in your browser from the checked rated games"}
        . A question mark means provisional. Bots are rated, not ranked.
      </Hint>
    </Section>
  );
}

function You({ model }: { model: LobbyModel }) {
  const summary =
    "flex cursor-pointer list-none items-center justify-between py-2 font-semibold [&::-webkit-details-marker]:hidden after:content-['+'] after:text-muted-foreground open:after:content-['–']";
  return (
    <section
      className="you grid gap-3 rounded-xl bg-surface p-4 text-[0.92rem]"
      aria-label="Your key"
    >
      <p className="flex items-center gap-2">
        <Icon name="key" className="text-brand" />
        <span>
          You are{" "}
          <a href={`#/player/${me}`} className="font-semibold hover:text-brand">
            <code title={nip19.npubEncode(me)} data-testid="me" className="font-mono text-[0.9em]">
              {who(me).name || shortKey(me)}
            </code>
          </a>
          , signing with{" "}
          {source === "extension" ? "your Nostr extension" : "a key kept in this browser"}.
        </span>
      </p>
      {source !== "extension" && (
        <Hint>
          Your key lives in this browser. It is your account here and in every other Nostr app.
        </Hint>
      )}
      <details className="wallet border-t border-line">
        <summary className={summary}>Zaps: your address and wallet</summary>
        <div className="grid gap-2 pb-2">
          {source === "extension" ? (
            <Hint>
              Zaps to you go to the lightning address in your Nostr profile
              {model.lud16 ? `, ${model.lud16}` : "; this relay has none for your key"}.
            </Hint>
          ) : (
            <>
              <form className="flex gap-2" onSubmit={submit("lud16")}>
                <input
                  name="lud16"
                  defaultValue={model.lud16}
                  placeholder="you@wallet.example"
                  aria-label="Lightning address"
                  data-testid="lud16"
                  className={input}
                />
                <button className={button}>Save</button>
              </form>
              <Hint>Where zaps to you go. It is published in your profile on this relay.</Hint>
            </>
          )}
          <form className="flex gap-2" onSubmit={submit("nwc")}>
            <input
              name="nwc"
              type="password"
              placeholder="nostr+walletconnect://…"
              aria-label="Nostr Wallet Connect"
              data-testid="nwc"
              className={input}
            />
            <button className={button}>Connect</button>
          </form>
          <Hint data-testid="wallet">
            {model.wallet
              ? `Zaps are paid with ${model.wallet}.`
              : "No wallet connected: a zap shows its invoice as text and QR."}{" "}
            An empty connection forgets the wallet.
          </Hint>
        </div>
      </details>
      <details className="key border-t border-line">
        <summary className={summary}>Use another key</summary>
        <form className="flex gap-2 pb-2" onSubmit={submit("key")}>
          <input
            name="key"
            type="password"
            placeholder="nsec1…"
            aria-label="Secret key"
            className={input}
          />
          <button className={cn(button, "whitespace-nowrap")}>Use this key</button>
        </form>
      </details>
    </section>
  );
}
