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
const SIDES = ["White", "Black"];
const PROMOTIONS = ["q", "n", "r", "b"];
const ICONS = {
  first: "M18 6l-6 6 6 6M7 6v12",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  last: "M6 6l6 6-6 6M17 6v12",
  flip: "M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3",
  flag: "M5 21V4h11l-2 4 2 4H5",
  abort: "M6 6l12 12M18 6L6 18",
  sun: "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
};
const icon = (name: keyof typeof ICONS) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M7 11.5h12.5a3.5 3.5 0 1 0-3.5-3.5M7 16.5h18M7 21.5h9.5a3.5 3.5 0 1 1-3.5 3.5"/></svg>`;

export type Who = (pubkey: string) => Profile;
export type Rate = (pubkey: string, speed: Speed) => Rating | undefined;
export type Board = {
  fen: string;
  flipped: boolean;
  selected: string | null;
  targets: string[];
  last: string[];
  check: string | null;
  premove: string[];
  promotion: { square: string; color: string } | null;
  dragging: string | null;
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
  rate: Rate;
  tc: string;
  rated: boolean;
  level: number;
  error: string;
};
export type Moves = { sans: string[]; ply: number };
export type GameModel = {
  game: Game;
  me: string;
  seat: Seat | null;
  loaded: boolean;
  board: Board;
  moves: Moves;
  who: Who;
  rate: Rate;
  shareUrl: string;
  copied: boolean;
  joining: boolean;
  confirming: boolean;
  signed: number;
  labels: { reviewer: string; label: string; detail: string }[];
};
export type ComputerModel = {
  board: Board;
  moves: Moves;
  level: number;
  seat: Seat;
  outcome: [string, string] | null;
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
const ratingOf = (rate: Rate, pubkey: string, tc: string) => {
  const speed = speedOf(tc);
  const rating = speed && rate(pubkey, speed);
  return rating ? `<span class="rating">${showRating(rating)}</span>` : "";
};
const player = (pubkey: string, who: Who, me = "") => {
  const { name, bot } = who(pubkey);
  return `${bot ? '<b class="bot">BOT</b> ' : ""}${esc(name || shortKey(pubkey))}${pubkey === me ? " (you)" : ""}`;
};
const href = (seek: { host: string; gameId: string }) => `#/${seek.host}/${seek.gameId}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const shell = (body: string, status: { online: boolean; relay: string; dark: boolean }) => `
  <header>
    <a class="brand" href="#/" data-testid="home">${LOGO}<span>Luft</span></a>
    <span class="relay ${status.online ? "on" : "off"}" data-testid="relay-status" title="${esc(status.relay)}">${
      status.online ? "relay connected" : "connecting…"
    }</span>
    <button class="ghost theme" data-action="theme" data-testid="theme" aria-label="Switch to ${status.dark ? "light" : "dark"} theme" title="Switch to ${status.dark ? "light" : "dark"} theme">${icon(status.dark ? "sun" : "moon")}</button>
  </header>
  <main>${body}</main>`;

export function boardView(board: Board): string {
  const rows = board.fen.split(" ")[0].split("/");
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
  if (board.flipped) squares.reverse();
  const cells = squares.map(({ name, piece, dark }, i) => {
    const classes = [
      "sq",
      dark ? "dark" : "light",
      name === board.selected && "sel",
      board.targets.includes(name) && (piece ? "target capture" : "target"),
      board.last.includes(name) && "last",
      board.premove.includes(name) && "pre",
      name === board.check && "check",
    ];
    const side = piece === piece.toLowerCase() ? "black" : "white";
    const code = `${side[0]}${piece.toUpperCase()}`;
    const coords = `${i % 8 === 0 ? `<span class="coord rank">${name[1]}</span>` : ""}${
      i >= 56 ? `<span class="coord file">${name[0]}</span>` : ""
    }`;
    return `<button class="${classes.filter(Boolean).join(" ")}" data-square="${name}" data-testid="sq-${name}" aria-label="${name}${
      piece ? ` ${side} ${piece.toLowerCase()}` : ""
    }">${coords}${piece ? `<i class="piece ${code}${name === board.dragging ? " lifted" : ""}"></i>` : ""}</button>`;
  });
  return `<div class="board" data-testid="board" data-fen="${board.fen}">${cells.join("")}${
    board.promotion ? promotionView(board.promotion, board.flipped) : ""
  }</div>`;
}

function promotionView({ square, color }: { square: string; color: string }, flipped: boolean) {
  const file = "abcdefgh".indexOf(square[0]);
  const column = flipped ? 7 - file : file;
  const top = (square[1] === "8") !== flipped;
  return `<div class="promotion" data-testid="promotion" data-action="promote-cancel" style="--column:${column}">
    <div class="choices ${top ? "top" : "bottom"}">${PROMOTIONS.map(
      (p) =>
        `<button data-action="promote" data-piece="${p}" data-testid="promote-${p}" aria-label="Promote to ${
          { q: "queen", n: "knight", r: "rook", b: "bishop" }[p]
        }"><i class="piece ${color}${p.toUpperCase()}"></i></button>`,
    ).join("")}</div></div>`;
}

const navBar = ({ sans, ply }: Moves) => {
  const button = (to: string, name: keyof typeof ICONS, label: string, off: boolean) =>
    `<button class="ghost" data-action="nav" data-to="${to}" aria-label="${label}"${off ? " disabled" : ""}>${icon(name)}</button>`;
  return `<nav class="navbar" aria-label="Moves">
    <button class="ghost" data-action="flip" data-testid="flip" aria-label="Flip the board" title="Flip the board (f)">${icon("flip")}</button>
    ${button("first", "first", "First move", ply === 0)}${button("prev", "prev", "Previous move", ply === 0)}${button(
      "next",
      "next",
      "Next move",
      ply === sans.length,
    )}${button("last", "last", "Last move", ply === sans.length)}</nav>`;
};

const moveList = ({ sans, ply }: Moves, result = "", empty = "") =>
  `<div class="moves" data-testid="moves">${Array.from(
    { length: Math.ceil(sans.length / 2) },
    (_, i) =>
      `<span class="n">${i + 1}</span>${[2 * i, 2 * i + 1]
        .map((n) =>
          n < sans.length
            ? `<button class="move${n + 1 === ply ? " on" : ""}" data-action="ply" data-ply="${n + 1}">${sans[n]}</button>`
            : "<span></span>",
        )
        .join("")}`,
  ).join("")}${sans.length || !empty ? "" : `<p class="empty">${empty}</p>`}${result}</div>`;

const outcomeText = (result: string, termination: string) =>
  result === "*"
    ? "Game aborted"
    : result === "1/2-1/2"
      ? `Draw by ${termination}`
      : `${SIDES[result === "1-0" ? 0 : 1]} wins by ${termination}`;
const banner = (score: string, text: string) =>
  `<div class="result" data-testid="outcome">${score ? `<strong>${score}</strong> ` : ""}<span>${text}</span></div>`;

const card = (seat: Seat, name: string, rating: string, clock: string, active: boolean) =>
  `<div class="player${active ? " active" : ""}" data-testid="seat-${seat}"><span class="side ${SIDES[seat].toLowerCase()}" title="${SIDES[seat]}"></span><span class="name">${name}</span>${rating}${clock}</div>`;

export function homeView(model: HomeModel): string {
  const { me, who, rate } = model;
  const options = [...new Set([...TIME_CONTROLS, model.tc])]
    .map(
      (tc) => `<option value="${tc}"${tc === model.tc ? " selected" : ""}>${tcLabel(tc)}</option>`,
    )
    .join("");
  const tile = (tc: string) => {
    const clock = parseTc(tc)!;
    const [time, speed] =
      "days" in clock
        ? [plural(clock.days, "day"), "Correspondence"]
        : [`${clock.base / 60}+${clock.inc}`, speedOf(tc)!];
    const waiting = model.seeks.filter((s) => s.tc === tc && !s.mine && !s.forMe).length;
    return `<button class="tile${tc === model.tc ? " current" : ""}" data-action="quick" data-tc="${tc}"><span class="time">${time}</span><span class="speed">${speed}</span>${
      waiting ? `<span class="waiting">${plural(waiting, "player")} waiting</span>` : ""
    }</button>`;
  };
  const seekRow = (seek: Seek) =>
    `<li><a href="${href(seek)}"><span class="who">${player(seek.host, who, me)}${ratingOf(rate, seek.host, seek.tc)}</span><span class="terms">${tcLabel(seek.tc)}</span><span class="mode">${
      seek.forMe ? "challenges you" : seek.rated ? "rated" : "casual"
    }</span></a></li>`;
  const none = (text: string) => `<li class="none">${text}</li>`;
  return `
  <div class="lobby">
    <section class="pairing" aria-labelledby="quick">
      <div class="heading"><h2 id="quick">Quick pairing</h2>
        <label class="switch"><input type="checkbox" name="rated" data-testid="rated"${model.rated ? " checked" : ""}><span></span>Rated</label></div>
      <div class="tiles">${TIME_CONTROLS.map(tile).join("")}</div>
      <p class="hint">A tile joins a player already waiting for that game, or opens a seek for others to find.</p>
      <h2>Open seeks</h2>
      <ul class="list seeks" data-testid="seeks">${model.seeks.map(seekRow).join("") || none("Nobody is waiting. Pick a tile to open a seek.")}</ul>
    </section>
    <aside class="actions">
      <details class="action" open>
        <summary>Create a game</summary>
        <div class="row"><select name="tc" data-testid="tc" aria-label="Time control">${options}</select>
        <button class="primary" data-action="create" data-testid="create">Create</button></div>
      </details>
      <details class="action friend">
        <summary>Play a friend</summary>
        <form class="row" data-form="challenge">
          <input name="npub" placeholder="npub1…" aria-label="Player to challenge">
          <button class="primary">Challenge</button>
        </form>
        <p class="hint">Or create a game and send its link.</p>
      </details>
      <details class="action computer">
        <summary>Play the computer</summary>
        <div class="levels" role="radiogroup" aria-label="Level">${[1, 2, 3, 4, 5, 6, 7, 8]
          .map(
            (n) =>
              `<label><input type="radio" name="level" value="${n}" data-testid="level-${n}"${n === model.level ? " checked" : ""}><span>${n}</span></label>`,
          )
          .join("")}</div>
        <a class="button primary" href="#/computer/${model.level}" data-testid="computer">Play level ${model.level}</a>
        <p class="hint">Stockfish in this browser. Casual, and nothing is published.</p>
      </details>
      <section class="action bots">
        <h3>Play a bot account</h3>
        <ul class="list" data-testid="bots">${
          model.bots
            .map(
              (bot) =>
                `<li><span class="who">${player(bot.pubkey, who)}${bot.rating ? ` <span class="rating">${showRating(bot.rating)}</span>` : ""}</span><button data-action="challenge-bot" data-pubkey="${bot.pubkey}" data-testid="challenge-bot" title="Challenge to ${terms(model.tc, model.rated)}">Challenge</button></li>`,
            )
            .join("") || none("No bot account is online on this relay.")
        }</ul>
        <p class="hint">${terms(model.tc, model.rated)}. A human's rating moves half as far against a bot.</p>
      </section>
      ${model.error ? `<p class="error" data-testid="error">${esc(model.error)}</p>` : ""}
    </aside>
    <section class="watch">
      <h2>Being played</h2>
      <ul class="list" data-testid="live">${
        model.live
          .map(
            (game) =>
              `<li><a href="${href(game)}"><span class="who">${player(game.host, who, me)} <i>vs</i> ${player(game.guest, who, me)}</span><span class="terms">${terms(game.tc, game.rated)}</span></a></li>`,
          )
          .join("") || none("No game is running.")
      }</ul>
      <h2>Recent games</h2>
      <p class="hint" data-testid="audit">${
        model.checking
          ? "Checking signatures…"
          : `${plural(model.results.length, "game")} checked out: every move's signature verified and the game replayed.${
              model.doubted
                ? ` ${plural(model.doubted, "archive")} did not check out and ${model.doubted === 1 ? "is" : "are"} not listed.`
                : ""
            }`
      }</p>
      <ul class="list results" data-testid="results">${model.results
        .map(
          (v) =>
            `<li><a href="#/${v.addr.split(":").slice(1).join("/")}"><span class="who">${player(v.players[0], who, me)} <b class="score">${v.result.replaceAll("1/2", "½")}</b> ${player(v.players[1], who, me)}</span><span class="terms">${v.termination} · ${terms(v.tc, v.rated)}</span></a></li>`,
        )
        .join("")}</ul>
    </section>
    <section class="ranks">
      <h2>Leaderboard</h2>
      <ol class="list" data-testid="ranks">${
        model.ranks
          .map(
            ({ pubkey, speed, rating }) =>
              `<li><span class="who">${player(pubkey, who, me)}</span><span class="terms">${speed} · ${plural(rating.games, "game")}</span><b class="rating">${showRating(rating)}</b></li>`,
          )
          .join("") || none("No rated game yet.")
      }</ol>
      <p class="hint">Glicko-2, computed in your browser from the checked rated games. A question mark means provisional. Bots are rated, not ranked.</p>
      <div class="you">
        <p>You are <code title="${nip19.npubEncode(me)}" data-testid="me">${shortKey(me)}</code>, signing with ${
          model.source === "extension" ? "your Nostr extension" : "a key kept in this browser"
        }.</p>
        <details class="key"><summary>Use another key</summary>
          <form class="row" data-form="key"><input name="key" type="password" placeholder="nsec1…" aria-label="Secret key"><button>Use this key</button></form>
        </details>
      </div>
    </section>
  </div>`;
}

function seatCard(model: GameModel, seat: Seat): string {
  const { game, who, me, rate } = model;
  const pubkey = game.players![seat];
  const running = game.phase === "playing" && turnOf(game) === seat && game.deadline !== null;
  const live = "base" in (parseTc(game.tc) ?? {});
  const clock = running
    ? `<span class="clock run" data-due="${game.deadline! * 1000}" data-testid="clock-${seat}"></span>`
    : live
      ? `<span class="clock" data-left="${game.clocks[seat]}" data-testid="clock-${seat}"></span>`
      : "";
  return card(
    seat,
    player(pubkey, who, me),
    ratingOf(rate, pubkey, game.tc),
    clock,
    game.phase === "playing" && turnOf(game) === seat,
  );
}

function lobbyCard(model: GameModel): string {
  const { game, me, who } = model;
  const share = `<div class="share"><input readonly value="${esc(model.shareUrl)}" aria-label="Link to this game"><button data-action="copy">${model.copied ? "Copied" : "Copy link"}</button></div>`;
  if (game.host === me)
    return `<section class="panel" data-testid="waiting"><div class="pulse" aria-hidden="true"></div><h2>Waiting for ${
      game.challenged ? player(game.challenged, who) : "an opponent"
    }</h2><p class="terms">${terms(game.tc, game.rated)}. Colours are drawn when the game starts.</p>${share}<p class="hint">Anyone with the link can join${
      game.challenged ? " if they hold the challenged key" : ""
    }. The seek also shows in the lobby.</p></section>`;
  const allowed = !game.challenged || game.challenged === me;
  return `<section class="panel"><h2>${player(game.host, who)}${ratingOf(model.rate, game.host, game.tc)} wants to play</h2><p class="terms">${terms(game.tc, game.rated)}. Colours are drawn when the game starts.</p>${
    allowed
      ? `<button class="primary big" data-action="join" data-testid="join"${model.joining ? " disabled" : ""}>${model.joining ? "Joining…" : "Join the game"}</button>`
      : "<p>This challenge is for someone else.</p>"
  }</section>`;
}

const tableView = (
  data: { seat: string; turn: string },
  board: Board,
  [top, bottom]: [string, string],
  rail: string,
) => `
  <div class="table" data-testid="table" data-seat="${data.seat}" data-turn="${data.turn}">
    <div class="top">${top}</div>
    ${boardView(board)}
    <div class="bottom">${bottom}</div>
    <div class="rail">${rail}</div>
  </div>`;

export function gameView(model: GameModel): string {
  const { game, seat } = model;
  if (!model.loaded) return '<p class="note">Looking for the game…</p>';
  if (game.phase === "missing")
    return '<p class="note" data-testid="missing">There is no such game on this relay.</p>';
  if (game.phase === "open") return lobbyCard(model);
  const over = game.phase === "finished";
  const turn = turnOf(game);
  const status = over
    ? ""
    : `<p class="status" data-testid="status">${
        seat === null
          ? `${SIDES[turn]} to move. You are watching.`
          : seat === turn
            ? "Your move."
            : `Waiting for ${SIDES[turn]}.`
      }</p>`;
  const offer =
    over || game.drawOffer === null || game.drawOffer === seat
      ? ""
      : `<p class="offer" data-testid="draw-offered">${SIDES[game.drawOffer]} offers a draw.</p>`;
  const resign = model.confirming
    ? '<button class="danger" data-action="resign-confirm" data-testid="resign-confirm">Confirm resign</button><button data-action="resign-cancel">Keep playing</button>'
    : `<button data-action="resign" data-testid="resign" title="Resign">${icon("flag")}Resign</button>`;
  const controls =
    over || seat === null
      ? over
        ? '<div class="controls"><a class="button primary" href="#/">New game</a></div>'
        : ""
      : `<div class="controls">${
          game.sans.length < 2
            ? `<button data-action="abort" data-testid="abort">${icon("abort")}Abort</button>`
            : `${resign}${
                model.confirming
                  ? ""
                  : game.drawOffer !== null && game.drawOffer !== seat
                    ? '<button class="primary" data-action="draw-accept" data-testid="draw-accept">Accept draw</button>'
                    : `<button data-action="draw-offer" data-testid="draw-offer"${game.drawOffer === seat ? " disabled" : ""}><span class="half">½</span>${
                        game.drawOffer === seat ? "Draw offered" : "Offer draw"
                      }</button>`
              }`
        }</div>`;
  const archive =
    over && game.result !== "*"
      ? `<p class="hint proof" data-testid="${model.signed ? "signed" : "unsigned"}">${
          model.signed
            ? `Archived as a signed NIP-64 note by ${model.signed === 1 ? "one player" : "both players"}.`
            : "No signed archive on the relay yet."
        }</p>`
      : "";
  const labels = model.labels.length
    ? `<ul class="labels" data-testid="labels">${model.labels
        .map(
          (label) =>
            `<li><b class="${esc(label.label)}">${esc(label.label)}</b> ${esc(label.detail)} <small>reviewer ${shortKey(label.reviewer)}</small></li>`,
        )
        .join("")}</ul>`
    : "";
  const result = over
    ? banner(
        game.result === "*" ? "" : game.result!.replaceAll("1/2", "½"),
        outcomeText(game.result!, game.termination),
      )
    : "";
  const top = (model.board.flipped ? 0 : 1) as Seat;
  return tableView(
    { seat: String(seat ?? ""), turn: over ? "" : String(turn) },
    model.board,
    [seatCard(model, top), seatCard(model, (1 - top) as Seat)],
    `<p class="terms">${terms(game.tc, game.rated)}</p>${navBar(model.moves)}${moveList(model.moves, result, "The first two moves are not timed.")}${status}${offer}${controls}${archive}${labels}`,
  );
}

export function computerView(model: ComputerModel) {
  const computer = card(
    (1 - model.seat) as Seat,
    `<b class="bot">BOT</b> Stockfish`,
    `<span class="rating">level ${model.level}</span>`,
    "",
    model.thinking,
  );
  const you = card(model.seat, "You", "", "", !model.thinking && !model.outcome);
  const flipped = model.board.flipped;
  return tableView(
    { seat: String(model.seat), turn: "" },
    model.board,
    flipped === (model.seat === 1) ? [computer, you] : [you, computer],
    `<p class="terms">Casual, in this browser. Nothing is published.</p>${navBar(model.moves)}${moveList(
      model.moves,
      model.outcome ? banner(...model.outcome) : "",
    )}${
      model.outcome
        ? ""
        : `<p class="status" data-testid="status">${model.thinking ? "The computer is thinking…" : "Your move."}</p>`
    }<div class="controls">
        <button class="primary" data-action="again" data-testid="again">New game</button>
        <button data-action="swap">Play ${SIDES[1 - model.seat]}</button>
      </div>`,
  );
}

export const computerOutcome = (checkmate: boolean, winner: Seat): [string, string] =>
  checkmate
    ? [winner === 0 ? "1-0" : "0-1", outcomeText(winner === 0 ? "1-0" : "0-1", "checkmate")]
    : ["½-½", "Draw"];
