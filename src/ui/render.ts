import * as nip19 from "nostr-tools/nip19";
import type { Verdict } from "../game/archive.ts";
import { parseTc, type Profile, type Speed, speedOf } from "../game/events.ts";
import { PROVISIONAL_RD, type Rating } from "../game/glicko.ts";
import { type Game, type Seat, turnOf } from "../game/replay.ts";

export const TIME_CONTROLS = [
  "180+2",
  "300+0",
  "300+3",
  "600+0",
  "600+5",
  "900+10",
  "1800+0",
  "1d",
  "3d",
];
const GLYPHS: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎" };
const SIDES = ["White", "Black"];

export type Who = (pubkey: string) => Profile;
export type Board = {
  fen: string;
  flipped: boolean;
  selected: string | null;
  targets: string[];
  last: string[];
};
export type Seek = {
  host: string;
  gameId: string;
  tc: string;
  rated: boolean;
  mine: boolean;
  forMe: boolean;
};
export type HomeModel = {
  me: string;
  source: string;
  seeks: Seek[];
  live: (Seek & { guest: string })[];
  results: Verdict[];
  checking: boolean;
  doubted: number;
  ranks: { pubkey: string; speed: Speed; rating: Rating }[];
  bots: { pubkey: string; rating?: Rating }[];
  who: Who;
  tc: string;
  rated: boolean;
  level: number;
  error: string;
};
export type GameModel = {
  game: Game;
  me: string;
  seat: Seat | null;
  loaded: boolean;
  board: Board;
  who: Who;
  shareUrl: string;
  copied: boolean;
  joining: boolean;
  signed: number;
  labels: { reviewer: string; label: string; detail: string }[];
};
export type ComputerModel = {
  board: Board;
  level: number;
  seat: Seat;
  sans: string[];
  outcome: string;
  thinking: boolean;
};

const esc = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
export const shortKey = (pubkey: string) => `${nip19.npubEncode(pubkey).slice(0, 12)}…`;

export function tcLabel(tc: string): string {
  const clock = parseTc(tc);
  if (!clock) return tc;
  if ("days" in clock) return `${clock.days} day${clock.days > 1 ? "s" : ""} a move`;
  return `${clock.base / 60}+${clock.inc} ${speedOf(tc)}`;
}
const terms = (tc: string, rated: boolean) => `${tcLabel(tc)}, ${rated ? "rated" : "casual"}`;
const showRating = ({ r, rd }: Rating) => `${Math.round(r)}${rd >= PROVISIONAL_RD ? "?" : ""}`;
const player = (pubkey: string, who: Who, me = "") => {
  const { name, bot } = who(pubkey);
  return `${bot ? '<b class="bot">BOT</b> ' : ""}${esc(name || shortKey(pubkey))}${pubkey === me ? " (you)" : ""}`;
};
const href = (seek: { host: string; gameId: string }) => `#/${seek.host}/${seek.gameId}`;

export const shell = (body: string, status: { online: boolean; relay: string }) => `
  <header>
    <a class="brand" href="#/" data-testid="home">Luft</a>
    <span class="tagline">chess between Nostr keys</span>
    <span class="relay ${status.online ? "on" : "off"}" data-testid="relay-status" title="${esc(status.relay)}">${
      status.online ? "relay connected" : "connecting…"
    }</span>
  </header>
  <main>${body}</main>`;

export function boardView({ fen, flipped, selected, targets, last }: Board): string {
  const rows = fen.split(" ")[0].split("/");
  const squares = rows.flatMap((row, r) => {
    const cells = [...row].flatMap((char) =>
      /\d/.test(char) ? Array<string>(Number(char)).fill("") : char,
    );
    return cells.map((piece, f) => ({
      name: "abcdefgh"[f] + (8 - r),
      piece,
      dark: (r + f) % 2 === 1,
    }));
  });
  if (flipped) squares.reverse();
  return `<div class="board" data-testid="board" data-fen="${fen}">${squares
    .map(({ name, piece, dark }) => {
      const classes = [
        "sq",
        dark ? "dark" : "light",
        name === selected ? "sel" : "",
        targets.includes(name) ? "target" : "",
        last.includes(name) ? "last" : "",
      ];
      const side = piece === piece.toLowerCase() ? "black" : "white";
      return `<button class="${classes.join(" ").trim()}" data-action="square" data-square="${name}" data-testid="sq-${name}" aria-label="${name}${
        piece ? ` ${side} ${piece.toLowerCase()}` : ""
      }">${piece ? `<span class="piece ${side}">${GLYPHS[piece.toLowerCase()]}</span>` : ""}</button>`;
    })
    .join("")}</div>`;
}

const moveList = (sans: string[]) =>
  `<ol class="moves" data-testid="moves">${Array.from(
    { length: Math.ceil(sans.length / 2) },
    (_, i) => `<li><span>${sans[2 * i]}</span><span>${sans[2 * i + 1] ?? ""}</span></li>`,
  ).join("")}</ol>`;

const outcomeText = (result: string, termination: string) =>
  result === "*"
    ? "Game aborted"
    : result === "1/2-1/2"
      ? `Draw by ${termination}`
      : `${SIDES[result === "1-0" ? 0 : 1]} wins by ${termination}`;

export function homeView(model: HomeModel): string {
  const { me, who } = model;
  const options = TIME_CONTROLS.map(
    (tc) => `<option value="${tc}"${tc === model.tc ? " selected" : ""}>${tcLabel(tc)}</option>`,
  ).join("");
  const seekRow = (seek: Seek) =>
    `<li><a href="${href(seek)}">${player(seek.host, who, me)}</a><span>${terms(seek.tc, seek.rated)}${
      seek.forMe ? " · challenges you" : ""
    }</span></li>`;
  return `
  <section class="card new">
    <h2>New game</h2>
    <div class="row">
      <label>Time <select name="tc" data-testid="tc">${options}</select></label>
      <label class="check"><input type="checkbox" name="rated" data-testid="rated"${model.rated ? " checked" : ""}> Rated</label>
      <button class="primary" data-action="create" data-testid="create">Create a seek</button>
    </div>
    <form class="row" data-form="challenge">
      <input name="npub" placeholder="npub1… to challenge one player" aria-label="Player to challenge">
      <button>Challenge</button>
    </form>
    ${model.error ? `<p class="error" data-testid="error">${esc(model.error)}</p>` : ""}
  </section>
  <section class="card">
    <h2>Bots</h2>
    <ul class="list" data-testid="bots">${
      model.bots
        .map(
          (bot) =>
            `<li><span>${player(bot.pubkey, who)}${bot.rating ? ` <small>${showRating(bot.rating)}</small>` : ""}</span><button data-action="challenge-bot" data-pubkey="${bot.pubkey}" data-testid="challenge-bot">Challenge, ${terms(model.tc, model.rated)}</button></li>`,
        )
        .join("") || '<li class="none">No bot account is online on this relay.</li>'
    }</ul>
    <div class="row">
      <label>Or the computer in this browser, level
        <select name="level" data-testid="level">${[1, 2, 3, 4, 5, 6, 7, 8]
          .map((n) => `<option${n === model.level ? " selected" : ""}>${n}</option>`)
          .join("")}</select></label>
      <a class="button" href="#/computer/${model.level}" data-testid="computer">Play, casual</a>
    </div>
    <p class="hint">Games against a bot account are ordinary games and can be rated; a human's rating moves half as far in them. The computer in the browser is never rated and publishes nothing.</p>
  </section>
  <section class="card">
    <h2>Open games</h2>
    <ul class="list" data-testid="seeks">${model.seeks.map(seekRow).join("") || '<li class="none">Nobody is waiting. Create a seek.</li>'}</ul>
    <h2>Being played</h2>
    <ul class="list" data-testid="live">${
      model.live
        .map(
          (game) =>
            `<li><a href="${href(game)}">${player(game.host, who, me)} and ${player(game.guest, who, me)}</a><span>${terms(game.tc, game.rated)}</span></li>`,
        )
        .join("") || '<li class="none">No game is running.</li>'
    }</ul>
  </section>
  <section class="card">
    <h2>Results</h2>
    <p class="hint" data-testid="audit">${
      model.checking
        ? "Checking signatures…"
        : `${model.results.length} game${model.results.length === 1 ? "" : "s"} checked out: every move's signature verified and the game replayed.${
            model.doubted
              ? ` ${model.doubted} archive${model.doubted === 1 ? "" : "s"} did not check out and ${model.doubted === 1 ? "is" : "are"} not listed.`
              : ""
          }`
    }</p>
    <ul class="list results" data-testid="results">${model.results
      .map(
        (v) =>
          `<li><a href="#/${v.addr.split(":").slice(1).join("/")}">${player(v.players[0], who, me)} <b>${v.result}</b> ${player(v.players[1], who, me)}</a><span>${v.termination} · ${terms(v.tc, v.rated)}</span></li>`,
      )
      .join("")}</ul>
    <h2>Ratings</h2>
    <p class="hint">Glicko-2 as on Lichess, computed in your browser from the checked rated games. A question mark means provisional. Bots are rated but not ranked.</p>
    <ul class="list" data-testid="ranks">${
      model.ranks
        .map(
          ({ pubkey, speed, rating }) =>
            `<li><span>${player(pubkey, who, me)}</span><span>${speed} <b>${showRating(rating)}</b> · ${rating.games} game${rating.games === 1 ? "" : "s"}</span></li>`,
        )
        .join("") || '<li class="none">No rated game yet.</li>'
    }</ul>
  </section>
  <section class="card you">
    <p>You are <code title="${nip19.npubEncode(me)}" data-testid="me">${shortKey(me)}</code>, signing with ${
      model.source === "extension" ? "your Nostr extension" : "a key kept in this browser"
    }.</p>
    <details class="key"><summary>Use another key</summary>
      <form class="row" data-form="key"><input name="key" type="password" placeholder="nsec1…" aria-label="Secret key"><button>Use this key</button></form>
    </details>
  </section>`;
}

function seatBar(model: GameModel, seat: Seat): string {
  const { game, who, me } = model;
  const running = game.phase === "playing" && turnOf(game) === seat && game.deadline !== null;
  const live = "base" in (parseTc(game.tc) ?? {});
  const clock = running
    ? `<span class="clock run" data-due="${game.deadline! * 1000}" data-testid="clock-${seat}"></span>`
    : live
      ? `<span class="clock" data-left="${game.clocks[seat]}" data-testid="clock-${seat}"></span>`
      : "";
  return `<div class="seat" data-testid="seat-${seat}"><span class="dot ${SIDES[seat].toLowerCase()}"></span><span class="name">${player(game.players![seat], who, me)}</span>${clock}</div>`;
}

export function gameView(model: GameModel): string {
  const { game, seat, me, who } = model;
  if (!model.loaded) return '<p class="note">Looking for the game…</p>';
  if (game.phase === "missing")
    return '<p class="note" data-testid="missing">There is no such game on this relay.</p>';
  if (game.phase === "open") {
    const share = `<p class="share"><input readonly value="${esc(model.shareUrl)}" aria-label="Link to this game"><button data-action="copy">${model.copied ? "Copied" : "Copy link"}</button></p>`;
    if (game.host === me)
      return `<section class="card" data-testid="waiting"><h2>Waiting for ${
        game.challenged ? player(game.challenged, who) : "an opponent"
      }</h2><p>${terms(game.tc, game.rated)}. Colours are drawn when the game starts.</p>${share}</section>`;
    const allowed = !game.challenged || game.challenged === me;
    return `<section class="card"><h2>${player(game.host, who)} wants to play</h2><p>${terms(game.tc, game.rated)}.</p>${
      allowed
        ? `<button class="primary" data-action="join" data-testid="join"${model.joining ? " disabled" : ""}>${model.joining ? "Joining…" : "Join"}</button>`
        : "<p>This challenge is for someone else.</p>"
    }</section>`;
  }
  const over = game.phase === "finished";
  const turn = turnOf(game);
  const status = over
    ? `<strong data-testid="outcome">${game.result === "*" ? "" : `${game.result} · `}${outcomeText(game.result!, game.termination)}</strong>`
    : seat === null
      ? `${SIDES[turn]} to move. You are watching.`
      : seat === turn
        ? "Your move."
        : `Waiting for ${SIDES[turn]}.`;
  const offer =
    game.drawOffer === null
      ? ""
      : game.drawOffer === seat
        ? "<p>You offered a draw.</p>"
        : `<p data-testid="draw-offered">${SIDES[game.drawOffer]} offers a draw.</p>`;
  const controls =
    over || seat === null
      ? ""
      : `<div class="row controls">${
          game.sans.length < 2
            ? '<button data-action="abort" data-testid="abort">Abort</button>'
            : `<button data-action="resign" data-testid="resign">Resign</button>${
                game.drawOffer !== null && game.drawOffer !== seat
                  ? '<button class="primary" data-action="draw-accept" data-testid="draw-accept">Accept draw</button>'
                  : `<button data-action="draw-offer" data-testid="draw-offer"${game.drawOffer === seat ? " disabled" : ""}>Offer draw</button>`
              }`
        }</div>`;
  const top = (model.board.flipped ? 0 : 1) as Seat;
  return `
  <div class="table" data-testid="table" data-seat="${seat ?? ""}" data-turn="${over ? "" : turn}">
    ${boardView(model.board)}
    <aside>
      ${seatBar(model, top)}
      <p class="terms">${terms(game.tc, game.rated)}</p>
      ${moveList(game.sans)}
      <p class="status" data-testid="status">${status}</p>
      ${offer}${controls}
      ${
        over && game.result !== "*"
          ? `<p class="hint" data-testid="${model.signed ? "signed" : "unsigned"}">${
              model.signed
                ? `Archived as a signed NIP-64 note by ${model.signed === 1 ? "one player" : "both players"}.`
                : "No signed archive on the relay yet."
            }</p>`
          : ""
      }
      ${
        model.labels.length
          ? `<ul class="labels" data-testid="labels">${model.labels
              .map(
                (label) =>
                  `<li><b class="${esc(label.label)}">${esc(label.label)}</b> ${esc(label.detail)} <small>reviewer ${shortKey(label.reviewer)}</small></li>`,
              )
              .join("")}</ul>`
          : ""
      }
      ${seatBar(model, (1 - top) as Seat)}
    </aside>
  </div>`;
}

export const computerView = (model: ComputerModel) => `
  <div class="table" data-testid="table" data-seat="${model.seat}">
    ${boardView(model.board)}
    <aside>
      <div class="seat"><span class="dot ${SIDES[1 - model.seat].toLowerCase()}"></span><span class="name">Computer, level ${model.level}</span></div>
      <p class="terms">Casual. Nothing is published.</p>
      ${moveList(model.sans)}
      <p class="status" data-testid="status">${
        model.outcome
          ? `<strong data-testid="outcome">${model.outcome}</strong>`
          : model.thinking
            ? "The computer is thinking…"
            : "Your move."
      }</p>
      <div class="row controls">
        <button data-action="again" data-testid="again">New game</button>
        <button data-action="swap">Play ${SIDES[1 - model.seat]}</button>
      </div>
      <div class="seat"><span class="dot ${SIDES[model.seat].toLowerCase()}"></span><span class="name">You</span></div>
    </aside>
  </div>`;

export const computerOutcome = (checkmate: boolean, winner: Seat) =>
  checkmate ? outcomeText(winner === 0 ? "1-0" : "0-1", "checkmate") : "Draw";
