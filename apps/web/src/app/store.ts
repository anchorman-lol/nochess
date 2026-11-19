import { audit, auditAll, type Verdict } from "@luft/core/game/archive.ts";
import { trusted, verify, withTrusted } from "@luft/core/game/assertion.ts";
import {
  address,
  build,
  covers,
  type GameEvent,
  KIND,
  NOBODY,
  type Profile,
  profileOf,
  speedOf,
  type Speed,
  tagValue,
  termsOf,
  TOPIC,
} from "@luft/core/game/events.ts";
import { type Rating, ratings } from "@luft/core/game/glicko.ts";
import { type Game, type Seat } from "@luft/core/game/replay.ts";
import { openGame, Table } from "@luft/core/game/table.ts";
import { Net } from "@luft/core/nostr/net.ts";
import { payUrl } from "@luft/core/zap/lnurl.ts";
import type { Zap } from "@luft/core/zap/zap.ts";
import { BRAND } from "@luft/ui/brand";
import { Chess } from "chess.js";
import { type ChatLine, mayWrite, rateLimited, type Room } from "../chat/rules.ts";
import { play as playSound, setMusic } from "../lib/audio.ts";
import { isPromotion, position, targets } from "../lib/board.ts";
import { loadSettings, mute, saveSettings, type Settings } from "../lib/settings.ts";
import { soundFor } from "../lib/sound.ts";
import { shortKey } from "../lib/format.ts";
import {
  followRelayHint,
  gameLink,
  importKey,
  loadSigner,
  parseGameLink,
  parsePubkey,
  relayUrls,
} from "../nostr/browser.ts";
import { zapper } from "../zap/sheet.ts";
import { setNwc, walletName } from "../zap/wallet.ts";

export type Who = (pubkey: string) => Profile;
export type Rate = (pubkey: string, speed: Speed) => Rating | undefined;
export type Data = Record<string, string | undefined>;
export type BoardModel = {
  fen: string;
  flipped: boolean;
  selected: string | null;
  targets: string[];
  last: string[];
  check: string | null;
  premove: string[];
  promotion: { square: string; color: string } | null;
  dragging: string | null;
  /** Bumps with each move that arrives, so the moved piece slides once. */
  ply: number;
  /** The last move was dropped by hand, so it doesn't slide. */
  dropped: boolean;
};
export type Moves = { sans: string[]; ply: number };
export type Seek = {
  host: string;
  gameId: string;
  tc: string;
  rated: boolean;
  mine: boolean;
  forMe: boolean;
  guest?: string;
};

/** What the board needs from a game: its moves, my side, and a way to play. */
type Play = {
  sans(): string[];
  seat(): Seat | null;
  open(): boolean;
  move(from: string, to: string, promotion?: string): boolean;
};
type Base = {
  act(action: string, data: Data): void;
  leave(): void;
  play?: Play;
  /** Runs on every repaint, before the views read the state. */
  tick?(): void;
};
export type Route =
  | (Base & { name: "landing"; view(): LandingModel })
  | (Base & {
      name: "lobby";
      view(): LobbyModel;
      submit(form: string, value: string): void;
      change(name: string, value: string | boolean): void;
    })
  | (Base & { name: "game"; view(): GameModel })
  | (Base & { name: "profile"; view(): ProfileModel })
  | (Base & { name: "computer"; view(): ComputerModel })
  | (Base & { name: "settings"; view(): null });

const LIVE_FOR = 6 * 60 * 60;
/** Who gets the platform's share of a zap: both set, or there is no share. */
export const PLATFORM: { pubkey: string; lud16: string } | null =
  import.meta.env.VITE_PLATFORM_PUBKEY && import.meta.env.VITE_PLATFORM_LUD16
    ? { pubkey: import.meta.env.VITE_PLATFORM_PUBKEY, lud16: import.meta.env.VITE_PLATFORM_LUD16 }
    : null;
/** The raters whose published ratings are shown in place of the ones computed here. */
const RATERS: string[] = (import.meta.env.VITE_RATERS ?? "").split(",").filter(Boolean);
const DEV_WALLET: string = import.meta.env.VITE_DEV_WALLET ?? "";
if (DEV_WALLET) (await import("../zap/devwallet.ts")).install(DEV_WALLET);
const WELCOMED = "luft:welcomed";
const nowSec = () => Math.floor(Date.now() / 1000);

let version = 0;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getVersion = () => version;
function paint() {
  if (route?.play) sync(route.play);
  route?.tick?.();
  version++;
  for (const listener of listeners) listener();
}

export let settings = loadSettings(localStorage);
export function setSettings(next: Settings) {
  settings = next;
  saveSettings(localStorage, next);
  applySettings();
  setMusic(next);
  paint();
}
export function applySettings() {
  const root = document.documentElement;
  root.dataset.theme =
    settings.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.theme;
  root.dataset.board = settings.board;
  root.dataset.pieces = settings.pieces;
}
export const sound = (name: Parameters<typeof playSound>[0]) => playSound(name, settings);

const signer = await loadSigner();
export const me = signer.pubkey;
export const source = signer.source;
export const net = new Net(relayUrls(), signer, () => paint());
const profiles = new Map<string, GameEvent>();
const wanted = new Set<string>();
let asking: string[] = [];
const keep = (event: GameEvent) => {
  if ((profiles.get(event.pubkey)?.created_at ?? -1) < event.created_at)
    profiles.set(event.pubkey, event);
  paint();
};
/** A profile without the topic tag, a human's from another client, is asked for once it is shown. */
function need(pubkey: string) {
  if (wanted.has(pubkey)) return;
  wanted.add(pubkey);
  if (!asking.length)
    queueMicrotask(() => {
      const authors = asking;
      asking = [];
      net.fetch([{ kinds: [KIND.profile], authors }]).then(
        (events) => events.forEach(keep),
        () => authors.forEach((author) => wanted.delete(author)),
      );
    });
  asking.push(pubkey);
}
export const who: Who = (pubkey) => {
  if (pubkey === PLATFORM?.pubkey) return { ...NOBODY, name: BRAND.name, lud16: PLATFORM.lud16 };
  const event = profiles.get(pubkey);
  if (!event) need(pubkey);
  return event ? profileOf(event) : NOBODY;
};
const isBot = (pubkey: string) => who(pubkey).bot;
net.subscribe([{ kinds: [KIND.profile], "#t": [TOPIC] }], keep);
export const zap = zapper(net, who, PLATFORM?.pubkey ?? null, () => paint());
export const wallet = () =>
  DEV_WALLET && window.webln ? "the dev wallet (play money)" : walletName();
export const nameOf = (pubkey: string) => who(pubkey).name || shortKey(pubkey);

/** Every archived game, audited one at a time so a long list never freezes the page. */
const notes = new Map<string, GameEvent>();
const verdicts = new Map<string, Verdict | null>();
let checking = true;
let auditTimer: ReturnType<typeof setTimeout> | undefined;
const archived = () => Map.groupBy(notes.values(), (note) => tagValue(note, "a") ?? "");
async function check() {
  for (const [addr, group] of archived()) {
    const key = `${addr}|${group.length}`;
    if (verdicts.has(key)) continue;
    verdicts.set(key, audit(group));
    paint();
    await new Promise((resolve) => setTimeout(resolve));
  }
  checking = false;
  paint();
}
const checkSoon = () => {
  clearTimeout(auditTimer);
  auditTimer = setTimeout(() => void check(), 200);
};
net.subscribe(
  [{ kinds: [KIND.archive], "#t": [TOPIC], limit: 120 }],
  (event) => {
    notes.set(event.id, event);
    checkSoon();
  },
  checkSoon,
);
function audited() {
  const all = [...archived()].map(([addr, group]) => verdicts.get(`${addr}|${group.length}`));
  const results = all.filter((verdict) => verdict != null).sort((a, b) => b.endedAt - a.endedAt);
  return { results, doubted: all.filter((verdict) => verdict === null).length };
}
const assertions = new Map<string, GameEvent>();
if (RATERS.length)
  net.subscribe([{ kinds: [KIND.rating], authors: RATERS, "#t": [TOPIC] }], (event) => {
    const key = `${event.pubkey}:${tagValue(event, "d")}`;
    if ((assertions.get(key)?.created_at ?? -1) < event.created_at) assertions.set(key, event);
    rated = undefined;
    paint();
  });
const asserted = () => trusted([...assertions.values()], RATERS);
let rated: { key: string; table: ReturnType<typeof ratings> } | undefined;
/** A trusted rater's numbers for the players it has rated, this browser's own for the rest. */
function ratingTable() {
  const { results } = audited();
  const key = `${results.length}|${profiles.size}`;
  if (rated?.key !== key) rated = { key, table: withTrusted(ratings(results, isBot), asserted()) };
  return rated.table;
}
export const rate: Rate = (pubkey, speed) => ratingTable().get(pubkey)?.[speed];

/** Live games and the latest checked results, for the landing page. */
const lobbies = new Map<string, GameEvent>();
net.subscribe([{ kinds: [KIND.game], "#t": [TOPIC], limit: 300 }], (event) => {
  const key = address(event.pubkey, tagValue(event, "d") ?? "");
  if ((lobbies.get(key)?.created_at ?? -1) < event.created_at) lobbies.set(key, event);
  paint();
});
function games() {
  const now = nowSec();
  const all = [...lobbies.values()].map((event): Seek & { event: GameEvent; guest: string } => ({
    event,
    host: event.pubkey,
    gameId: tagValue(event, "d") ?? "",
    ...termsOf(event),
    guest: tagValue(event, "p") ?? "",
    mine: event.pubkey === me,
    forMe: tagValue(event, "p") === me,
  }));
  const status = (seek: (typeof all)[number]) => tagValue(seek.event, "status");
  const finished = archived();
  return {
    seeks: all.filter(
      (seek) =>
        status(seek) === "open" &&
        speedOf(seek.tc) &&
        Number(tagValue(seek.event, "expiration")) > now &&
        (!seek.guest || seek.forMe || seek.mine),
    ),
    live: all.filter(
      (seek) =>
        status(seek) === "playing" &&
        !finished.has(address(seek.host, seek.gameId)) &&
        (speedOf(seek.tc) === "correspondence" || seek.event.created_at > now - LIVE_FOR),
    ),
  };
}

export let route: Route | undefined;
/** Board state that outlives a repaint: the piece in hand, the move being looked at, a premove. */
let view = fresh();
function fresh() {
  return {
    ply: null as number | null,
    flip: false,
    selected: null as string | null,
    premove: null as [string, string] | null,
    promoting: null as [string, string] | null,
    plies: -1,
    dropped: false,
    drag: null as { from: string; ghost: boolean; was: boolean } | null,
  };
}

const liveFen = (play: Play) => position(play.sans(), play.sans().length).fen;
const myTurn = (play: Play) =>
  play.open() && play.seat() !== null && play.sans().length % 2 === play.seat();

/** After a move arrives: drop what no longer fits, sound it, and play a premove that is now legal. */
function sync(play: Play) {
  const sans = play.sans();
  const plies = sans.length;
  if (plies === view.plies) return;
  if (view.plies >= 0 && plies === view.plies + 1) sound(soundFor(sans[plies - 1]));
  if (plies !== view.plies + 1) view.dropped = false;
  view.plies = plies;
  view.promoting = null;
  const seat = play.seat();
  if (view.selected && (seat === null || !targets(liveFen(play), view.selected, seat).length))
    view.selected = null;
  if (!play.open()) view.premove = null;
  if (view.premove && myTurn(play)) {
    const [from, to] = view.premove;
    view.premove = null;
    if (targets(liveFen(play), from, seat!).includes(to)) play.move(from, to, "q");
  }
}

function boardOf(play: Play): { board: BoardModel; moves: Moves } {
  const sans = play.sans();
  const ply = view.ply ?? sans.length;
  const { fen, last, check } = position(sans, ply);
  const seat = play.seat();
  const live = ply === sans.length;
  const selected = live && play.open() ? view.selected : null;
  return {
    board: {
      fen,
      last,
      check,
      flipped: (seat === 1) !== view.flip,
      selected,
      targets: selected && seat !== null ? targets(fen, selected, seat) : [],
      premove: live ? (view.premove ?? []) : [],
      promotion:
        live && view.promoting && seat !== null
          ? { square: view.promoting[1], color: "wb"[seat] }
          : null,
      dragging: view.drag?.ghost ? view.drag.from : null,
      ply,
      dropped: live && view.dropped,
    },
    moves: { sans, ply },
  };
}

/** A move from the hand to `to`, or a premove when it isn't my turn yet. */
function drop(play: Play, from: string, to: string, byHand: boolean): void {
  const seat = play.seat()!;
  const fen = liveFen(play);
  view.selected = null;
  if (!targets(fen, from, seat).includes(to)) return pick(play, to);
  if (!myTurn(play)) view.premove = [from, to];
  else if (isPromotion(fen, from, to)) view.promoting = [from, to];
  else {
    view.dropped = byHand;
    play.move(from, to);
  }
}

/** A click on a square: pick up my piece, put it down, or let go. */
function pick(play: Play, square: string): void {
  const seat = play.seat();
  if (seat === null || !play.open()) return;
  if (view.ply !== null) {
    view.ply = null;
    return;
  }
  view.promoting = null;
  const { selected } = view;
  if (selected && selected !== square && targets(liveFen(play), selected, seat).includes(square))
    return drop(play, selected, square, false);
  view.premove = null;
  view.selected =
    selected !== square && targets(liveFen(play), square, seat).length ? square : null;
}

/** The board's input: clicks, drags and keys, shared by every route with a board. */
export const board = {
  click(square: string) {
    if (!route?.play) return;
    pick(route.play, square);
    paint();
  },
  /** A press on a square: true if it lifts my piece, so the board may start a drag. */
  press(square: string): boolean {
    const play = route?.play;
    if (!play) return false;
    const seat = play.seat();
    const mine =
      seat !== null &&
      view.ply === null &&
      play.open() &&
      targets(liveFen(play), square, seat).length;
    const into = view.selected && targets(liveFen(play), view.selected, seat ?? 0).includes(square);
    if (mine && !into) {
      view.drag = { from: square, ghost: false, was: view.selected === square };
      view.selected = square;
      view.premove = null;
      view.promoting = null;
      paint();
      return true;
    }
    pick(play, square);
    paint();
    return false;
  },
  lift() {
    if (view.drag) view.drag.ghost = true;
    paint();
  },
  release(over: string | null) {
    const drag = view.drag;
    const play = route?.play;
    view.drag = null;
    if (!drag || !play) return paint();
    if (drag.ghost && over && over !== drag.from) drop(play, drag.from, over, true);
    else if (!drag.ghost && drag.was) view.selected = null;
    paint();
  },
  cancel() {
    view.drag = null;
    paint();
  },
  promote(piece: string | null) {
    const play = route?.play;
    if (!play || !view.promoting) return;
    const [from, to] = view.promoting;
    view.promoting = null;
    if (piece) play.move(from, to, piece);
    paint();
  },
  flip() {
    view.flip = !view.flip;
    paint();
  },
  nav(to: string, ply?: number) {
    const sans = route?.play?.sans() ?? [];
    const now = view.ply ?? sans.length;
    const next =
      to === "first"
        ? 0
        : to === "prev"
          ? now - 1
          : to === "next"
            ? now + 1
            : to === "ply"
              ? ply!
              : sans.length;
    const clamped = Math.max(0, Math.min(sans.length, next));
    view.ply = clamped === sans.length ? null : clamped;
    view.selected = null;
    view.promoting = null;
    paint();
  },
  escape() {
    Object.assign(view, { selected: null, premove: null, promoting: null });
    paint();
  },
};

export type LandingModel = {
  live: (Seek & { guest: string })[];
  results: Verdict[];
  checked: number;
  bots: string[];
  online: boolean;
};
function landing(): Route {
  return {
    name: "landing",
    view: () => {
      const { results } = audited();
      return {
        live: games().live.slice(0, 3),
        results: results.filter((v) => v.result !== "*").slice(0, 4),
        checked: results.length,
        bots: [...profiles.keys()].filter(isBot),
        online: net.online,
      };
    },
    act() {},
    leave() {},
  };
}

export type LobbyModel = {
  seeks: Seek[];
  live: (Seek & { guest: string })[];
  results: Verdict[];
  checking: boolean;
  doubted: number;
  ranks: { pubkey: string; speed: Speed; rating: Rating }[];
  /** The time control of a quick seek on its way to the relay. */
  pending: string | null;
  /** `sats` is a bot's price a game, `plays` whether it takes the terms picked. */
  bots: { pubkey: string; rating?: Rating; sats: number; plays: boolean }[];
  tc: string;
  rated: boolean;
  level: number;
  error: string;
  /** Whether a trusted rater's assertions are in use. */
  trusted: boolean;
  /** How zaps from this browser are paid; empty if every invoice has to be shown. */
  wallet: string;
  lud16: string;
};
function lobby(): Route {
  localStorage.setItem(WELCOMED, "1");
  let tc = localStorage.getItem("luft:tc") ?? "300+3";
  if (!speedOf(tc)) tc = "300+3";
  let rated = localStorage.getItem("luft:rated") !== "0";
  let level = Number(localStorage.getItem("luft:level") ?? 3);
  let error = "";
  /** My open seeks, each with a table that admits a guest and renews it while the lobby is open. */
  const own = new Map<string, Table>();
  let pending: { tc: string; cancel: boolean } | null = null;
  const refresh = setInterval(paint, 20_000);

  /** Keeps a table for each of my open seeks, and follows one into its game when it starts. */
  function tend() {
    const mine = games().seeks.filter((seek) => seek.mine);
    if (mine.some((seek) => seek.tc === pending?.tc)) pending = null;
    for (const { gameId } of mine)
      if (!own.has(gameId))
        own.set(gameId, new Table(net, me, gameId, localStorage, () => paint()));
    for (const [gameId, table] of own) {
      if (mine.some((seek) => seek.gameId === gameId)) continue;
      table.close();
      own.delete(gameId);
      if (tagValue(lobbies.get(address(me, gameId))!, "status") === "playing")
        location.hash = `#/${me}/${gameId}`;
    }
  }

  function start(challenged?: string) {
    openGame(net, localStorage, { tc, rated }, challenged).then(
      (gameId) => (location.hash = `#/${me}/${gameId}`),
      (reason) => {
        error = `The relay didn't take the game: ${reason instanceof Error ? reason.message : reason}`;
        paint();
      },
    );
  }
  const save = () => {
    localStorage.setItem("luft:tc", tc);
    localStorage.setItem("luft:rated", rated ? "1" : "0");
    localStorage.setItem("luft:level", String(level));
  };

  return {
    name: "lobby",
    tick: tend,
    view() {
      const { results, doubted } = audited();
      const table = ratingTable();
      return {
        ...games(),
        pending: pending && !pending.cancel ? pending.tc : null,
        results: results.filter((verdict) => verdict.result !== "*").slice(0, 30),
        checking,
        doubted,
        ranks: [...table]
          .filter(([pubkey]) => !isBot(pubkey))
          .flatMap(([pubkey, speeds]) =>
            Object.entries(speeds).map(([speed, rating]) => ({
              pubkey,
              speed: speed as Speed,
              rating,
            })),
          )
          .sort((a, b) => b.rating.r - a.rating.r),
        bots: [...profiles.keys()].filter(isBot).map((pubkey) => ({
          pubkey,
          rating: table.get(pubkey)?.[speedOf(tc)!],
          sats: (who(pubkey).fee?.msat ?? 0) / 1000,
          plays: covers(who(pubkey), { tc, rated }),
        })),
        tc,
        rated,
        level,
        error,
        trusted: asserted().size > 0,
        wallet: wallet(),
        lud16: who(me).lud16,
      };
    },
    act(action, data) {
      if (action === "quick") {
        tc = data.tc!;
        save();
        const waiting = games().seeks.find(
          (seek) => seek.tc === tc && seek.rated === rated && !seek.mine && !seek.forMe,
        );
        if (waiting) location.hash = `#/${waiting.host}/${waiting.gameId}`;
        else {
          const seek = (pending = { tc, cancel: false });
          openGame(net, localStorage, { tc, rated }).then(
            (gameId) =>
              seek.cancel &&
              net.publish(build.cancelled(gameId, { tc: seek.tc, rated }, nowSec() + 1)),
            (reason) => {
              pending = null;
              error = `The relay didn't take the seek: ${reason instanceof Error ? reason.message : reason}`;
              paint();
            },
          );
        }
      } else if (action === "cancel-seek") {
        own.get(data.game!)?.cancel();
        if (pending && !data.game) pending.cancel = true;
      } else if (action === "create") start();
      else if (action === "challenge-bot") start(data.pubkey);
      paint();
    },
    change(name, value) {
      if (name === "tc" && speedOf(String(value))) tc = String(value);
      else if (name === "rated") rated = Boolean(value);
      else if (name === "level") level = Number(value);
      save();
      paint();
    },
    submit(form, value) {
      error = "";
      if (form === "challenge") {
        const pubkey = parsePubkey(value);
        if (pubkey && pubkey !== me) return start(pubkey);
        error = "That isn't another player's npub.";
      } else if (form === "lud16") {
        if (value && !payUrl({ lud16: value, lud06: "" }))
          error = "That isn't a lightning address: it looks like name@wallet.example.";
        else {
          let old = {};
          try {
            old = JSON.parse(profiles.get(me)?.content ?? "{}");
          } catch {
            // a profile that isn't JSON is replaced
          }
          void net.publish({
            kind: KIND.profile,
            created_at: nowSec(),
            tags: [["t", TOPIC]],
            content: JSON.stringify({ ...old, lud16: value || undefined }),
          });
        }
      } else if (form === "nwc") {
        if (!setNwc(value)) error = "That isn't a Nostr Wallet Connect link.";
      } else if (form === "key" && importKey(value)) return location.reload();
      else error = "That isn't a secret key: it should start with nsec1 or be 64 hex characters.";
      paint();
    },
    leave() {
      clearInterval(refresh);
      for (const table of own.values()) table.close();
    },
  };
}

export const FEE_RULE =
  "The fee is spent when the bot joins. If it never joins, the same payment covers your next challenge to it. There are no refunds.";
export const REVIEW_RULE =
  "The reviewer analyses the game once it sees your payment and publishes its labels here. A label says what an engine measured, never that someone cheated. There are no refunds.";

export type GameModel = {
  game: Game;
  seat: Seat | null;
  loaded: boolean;
  board: BoardModel;
  moves: Moves;
  shareUrl: string;
  copied: boolean;
  joining: boolean;
  confirming: boolean;
  signed: number;
  labels: { reviewer: string; label: string; detail: string; paid: boolean }[];
  /** Checked zaps that name this game. */
  zaps: Zap[];
  /** What the challenged bot charges, and whether a receipt for this game covers it. */
  fee: { sats: number; paid: boolean } | null;
  reviewers: { pubkey: string; sats: number; requested: boolean }[];
  chat: { lines: ChatLine[]; error: string };
};
function game(host: string, gameId: string): Route {
  const table = new Table(net, host, gameId, localStorage, () => paint());
  let copied = false;
  let joining = false;
  let confirming = false;
  let unconfirm: ReturnType<typeof setTimeout> | undefined;
  let phase = table.game.phase;
  const lines = new Map<string, ChatLine>();
  const sent: number[] = [];
  let chatError = "";
  const stopChat = net.subscribe(
    [{ kinds: [KIND.chat], "#a": [table.addr], limit: 300 }],
    (event) => {
      const room = tagValue(event, "room");
      if (room !== "players" && room !== "spectators") return;
      lines.set(event.id, {
        id: event.id,
        from: event.pubkey,
        room,
        text: event.content.slice(0, 1000),
        at: event.created_at,
      });
      paint();
    },
  );
  const shareUrl = () => location.origin + location.pathname + gameLink(host, gameId, net.url);
  const play: Play = {
    sans: () => table.game.sans,
    seat: () => table.seat(),
    open: () => table.game.phase === "playing",
    move: (from, to, promotion) => table.move({ from, to, promotion }),
  };

  return {
    name: "game",
    play,
    tick() {
      const { game } = table;
      if (phase === "playing" && game.phase === "finished" && !game.sans.at(-1)?.endsWith("#"))
        sound("end");
      phase = game.phase;
    },
    view() {
      const { game } = table;
      const players: string[] = game.players ?? [];
      const { board, moves } = boardOf(play);
      const zaps = zap.zaps(table.receipts).filter((z) => z.addr === table.addr);
      const botFee = game.challenged ? who(game.challenged).fee : null;
      const answered = new Set(table.labels.map((label) => tagValue(label, "e")));
      return {
        game,
        seat: table.seat(),
        loaded: table.loaded,
        board,
        moves,
        shareUrl: shareUrl(),
        copied,
        joining,
        confirming: confirming && game.phase === "playing",
        signed: new Set(
          table.archives.map((note) => note.pubkey).filter((key) => players.includes(key)),
        ).size,
        zaps,
        fee:
          botFee && game.phase === "open" && host === me
            ? {
                sats: botFee.msat / 1000,
                paid: zaps.some((z) => z.to === game.challenged && z.msat >= botFee.msat),
              }
            : null,
        reviewers:
          game.phase === "finished" && game.result !== "*"
            ? reviewers().map(([pubkey, fee]) => ({
                pubkey,
                sats: fee.msat / 1000,
                requested: zaps.some(
                  (z) => z.to === pubkey && z.msat >= fee.msat && !answered.has(z.id),
                ),
              }))
            : [],
        labels: table.labels.map((label) => {
          let detail = "";
          try {
            const { positions, matchRate, acpl, depth } = JSON.parse(label.content);
            detail = `${Math.round(matchRate * 100)}% engine match over ${positions} positions, average loss ${Math.round(acpl)} cp, depth ${depth}`;
          } catch {
            // a label without numbers
          }
          const seat = players.indexOf(tagValue(label, "p") ?? "");
          return {
            reviewer: label.pubkey,
            label: tagValue(label, "l") ?? "",
            detail: `${["White", "Black"][seat] ?? ""}: ${detail}`,
            paid: zaps.some((z) => z.id === tagValue(label, "e") && z.to === label.pubkey),
          };
        }),
        chat: { lines: [...lines.values()], error: chatError },
      };
    },
    act(action, data) {
      clearTimeout(unconfirm);
      confirming = false;
      const service = action === "pay-fee" ? table.game.challenged! : data.pubkey!;
      if (action === "pay-fee" || action === "request-review")
        zap.open({
          title:
            action === "pay-fee"
              ? `Pay ${nameOf(service)} to play`
              : `Ask ${nameOf(service)} for a review`,
          note: action === "pay-fee" ? FEE_RULE : REVIEW_RULE,
          to: [service],
          addr: table.addr,
          fee: who(service).fee!.msat / 1000,
        });
      else if (action === "cancel-seek") {
        table.cancel();
        location.hash = "#/play";
      } else if (action === "join") {
        joining = true;
        table.join();
      } else if (action === "copy") {
        void navigator.clipboard?.writeText(shareUrl());
        copied = true;
        setTimeout(() => {
          copied = false;
          paint();
        }, 2500);
      } else if (action === "resign") {
        confirming = true;
        unconfirm = setTimeout(() => {
          confirming = false;
          paint();
        }, 5000);
      } else if (action === "resign-confirm") table.act("resign");
      else if (action === "abort" || action.startsWith("draw-")) table.act(action as "abort");
      else if (action === "chat") {
        const room = data.room as Room;
        const text = (data.text ?? "").trim();
        const phase = table.game.phase === "finished" ? "finished" : "playing";
        chatError = "";
        if (!mayWrite({ me, players: table.game.players ?? [], phase, room }, text))
          chatError = "That can't be sent here.";
        else if (rateLimited(sent, Date.now())) chatError = "A moment, please: that was quick.";
        else {
          sent.push(Date.now());
          void net.publish(build.chat(table.addr, room, text, nowSec())).catch(() => {
            chatError = "The relay didn't take that line.";
            paint();
          });
        }
      } else if (action === "mute") setSettings(mute(settings, data.pubkey!, data.on === "1"));
      paint();
    },
    leave: () => {
      stopChat();
      table.close();
    },
  };
}

/** The services that review a game for a price. */
const reviewers = () =>
  [...profiles.keys()].flatMap((pubkey) => {
    const { fee } = who(pubkey);
    return fee?.role === "review" && fee.msat ? [[pubkey, fee] as const] : [];
  });

export type ProfileModel = {
  pubkey: string;
  ratings: Partial<Record<Speed, Rating>>;
  /** The trusted rater that asserted these ratings, and what recomputing them found. */
  rater: string | null;
  check: { ok: boolean; detail: string } | null;
  zaps: Zap[];
  games: Verdict[];
};
function profile(pubkey: string): Route {
  const receipts = new Map<string, GameEvent>();
  let check: { ok: boolean; detail: string } | null = null;
  const stop = net.subscribe([{ kinds: [KIND.zap], "#p": [pubkey], limit: 200 }], (event) => {
    receipts.set(event.id, event);
    paint();
  });
  return {
    name: "profile",
    view: () => ({
      pubkey,
      ratings: ratingTable().get(pubkey) ?? {},
      rater: asserted().get(pubkey)?.rater ?? null,
      check,
      zaps: zap
        .zaps(receipts.values())
        .filter((z) => z.to === pubkey)
        .sort((a, b) => b.at - a.at),
      games: audited()
        .results.filter((v) => v.result !== "*" && v.players.includes(pubkey))
        .slice(0, 20),
    }),
    /** Verify: every archive on the relay is audited again and the player's assertion recomputed. */
    act(action) {
      const claim = asserted().get(pubkey);
      if (action !== "verify" || !claim) return;
      void net.fetch([{ kinds: [KIND.archive], "#t": [TOPIC], limit: 5000 }]).then((archives) => {
        check = verify(claim, auditAll(archives), isBot);
        paint();
      });
    },
    leave: stop,
  };
}

export type ComputerModel = {
  board: BoardModel;
  moves: Moves;
  level: number;
  seat: Seat;
  outcome: { score: string; text: string } | null;
  thinking: boolean;
};
function computer(level: number): Route {
  const loaded = import("@luft/core/engine/uci.ts").then(({ Engine, LEVELS, workerPipe }) => ({
    engine: new Engine(
      workerPipe(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`),
      LEVELS[level - 1].skill,
    ),
    ms: LEVELS[level - 1].ms,
  }));
  let chess = new Chess();
  let seat: Seat = 0;
  let thinking = false;

  async function reply() {
    const game = chess;
    if (chess.isGameOver() || chess.turn() === "wb"[seat]) return;
    thinking = true;
    paint();
    const { engine, ms } = await loaded;
    const { best } = await engine.go(chess.fen(), `movetime ${ms}`);
    thinking = false;
    if (game !== chess) return;
    chess.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    paint();
  }
  function restart(as: Seat) {
    chess = new Chess();
    seat = as;
    view = fresh();
    void reply();
  }
  const play: Play = {
    sans: () => chess.history(),
    seat: () => seat,
    open: () => !chess.isGameOver(),
    move(from, to, promotion) {
      if (thinking) return false;
      try {
        chess.move({ from, to, promotion });
      } catch {
        return false;
      }
      void reply();
      return true;
    },
  };

  return {
    name: "computer",
    play,
    view() {
      const { board, moves } = boardOf(play);
      const winner = chess.turn() === "w" ? "0-1" : "1-0";
      return {
        board,
        moves,
        level,
        seat,
        outcome: chess.isGameOver()
          ? chess.isCheckmate()
            ? { score: winner, text: `${winner === "1-0" ? "White" : "Black"} wins by checkmate` }
            : { score: "½-½", text: "Draw" }
          : null,
        thinking,
      };
    },
    act(action) {
      if (action === "again") restart(seat);
      else if (action === "swap") restart((1 - seat) as Seat);
      paint();
    },
    leave: () => void loaded.then(({ engine }) => engine.close()),
  };
}

const simple = (name: "settings"): Route => ({ name, view: () => null, act() {}, leave() {} });

export function navigate() {
  route?.leave();
  zap.act("zap-close");
  view = fresh();
  const hash = location.hash;
  const level = Number(hash.match(/^#\/computer\/([1-8])$/)?.[1]);
  const { host, gameId, relay } = parseGameLink(hash);
  if (relay && /^wss?:\/\//.test(relay) && relay !== net.url) {
    followRelayHint(relay);
    return location.reload();
  }
  const [, shown] = hash.match(/^#\/player\/([0-9a-f]{64})$/) ?? [];
  const home = hash === "" || hash === "#" || hash === "#/";
  route = level
    ? computer(level)
    : shown
      ? profile(shown)
      : host
        ? game(host, gameId)
        : hash === "#/settings"
          ? simple("settings")
          : hash === "#/about" || (home && !localStorage.getItem(WELCOMED))
            ? landing()
            : lobby();
  window.scrollTo(0, 0);
  paint();
}

export const status = () => ({ online: net.online, relay: net.url });

/** The zap dialog's input, repainting after each change. */
export const zapSheet = {
  act(action: string, data: { i?: string; sats?: string } = {}) {
    zap.act(action, data);
    paint();
  },
  set(name: string, value: number) {
    if (zap.set(name, value)) paint();
  },
  /** Zaps players, optionally for a game, with the amount and the platform's share to pick. */
  open(to: string[], addr?: string) {
    zap.open({ title: `Zap ${to.map(nameOf).join(" and ")}`, to, addr });
    paint();
  },
};
