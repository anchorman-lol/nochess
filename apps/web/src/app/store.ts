import { audit, auditAll, type Verdict } from "@nochess/core/game/archive.ts";
import { trusted, verify, withTrusted } from "@nochess/core/game/assertion.ts";
import {
  address,
  build,
  covers,
  type GameEvent,
  KIND,
  NOBODY,
  type Profile,
  profileOf,
  readStatus,
  speedOf,
  type Speed,
  tagValue,
  termsOf,
  TOPIC,
  WAIT,
} from "@nochess/core/game/events.ts";
import { type Rating, ratings } from "@nochess/core/game/glicko.ts";
import {
  describeReliability,
  type Reliability,
  reliability,
  unproven,
} from "@nochess/core/game/reliability.ts";
import { type Game, type Seat } from "@nochess/core/game/replay.ts";
import { openGame, Table } from "@nochess/core/game/table.ts";
import {
  JESTER_KIND,
  type JesterGame,
  jesterGames,
  START_REF,
} from "@nochess/core/jester/jester.ts";
import { Net, timed } from "@nochess/core/nostr/net.ts";
import type { Filter } from "nostr-tools/filter";
import { payUrl } from "@nochess/core/zap/lnurl.ts";
import type { Zap } from "@nochess/core/zap/zap.ts";
import { BRAND } from "@nochess/ui/brand";
import { Chess } from "chess.js";
import { type ChatLine, mayWrite, rateLimited, type Room } from "../chat/rules.ts";
import { play as playSound, setMusic } from "../lib/audio.ts";
import { isPromotion, position, targets } from "../lib/board.ts";
import { loadSettings, mute, saveSettings, type Settings } from "../lib/settings.ts";
import { nextPage } from "../lib/paging.ts";
import { soundFor } from "../lib/sound.ts";
import { shortKey } from "../lib/format.ts";
import {
  followRelayHint,
  gameLink,
  importKey,
  JESTER_RELAYS,
  loadSigner,
  parseGameLink,
  parsePubkey,
  relayUrls,
  saveRelays,
  savedRelays,
  sharedRelay,
} from "../nostr/browser.ts";
import { mergeProfile, type ProfileEdits } from "../nostr/profile.ts";
import { editRelays, type RelayEdit } from "../nostr/relays.ts";
import { platformFrom } from "../zap/platform.ts";
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
  /** When the seek withdraws itself if nobody has joined. */
  joinBy: number;
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
  | (Base & { name: "list"; view(): ListModel })
  | (Base & { name: "settings"; view(): null });

const LIVE_FOR = 6 * 60 * 60;
export const PLATFORM = platformFrom(import.meta.env);
/** The raters whose published ratings are shown in place of the ones computed here. */
const RATERS: string[] = (import.meta.env.VITE_RATERS ?? "").split(",").filter(Boolean);
const DEV_WALLET: string = import.meta.env.VITE_DEV_WALLET ?? "";
if (DEV_WALLET) (await import("../zap/devwallet.ts")).install(DEV_WALLET);
const WELCOMED = "nochess:welcomed";
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
  followBots();
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
export const zap = zapper(net, who, PLATFORM, () => paint());
/** Each bot's newest NIP-38 status: whether it is online and has a free table. */
const statuses = new Map<string, GameEvent>();
net.subscribe([{ kinds: [KIND.status], "#t": [TOPIC] }], (event) => {
  if ((statuses.get(event.pubkey)?.created_at ?? -1) < event.created_at)
    statuses.set(event.pubkey, event);
  paint();
});

/** Bots' joins and declines, and zap receipts to them: what their records rest on. */
const botEvents = new Map<string, GameEvent>();
let followed = "";
let unfollow = () => {};
function followBots() {
  const bots = [...profiles.keys()].filter(isBot).sort();
  if (!bots.length || bots.join() === followed) return;
  followed = bots.join();
  unfollow();
  unfollow = net.subscribe(
    [
      { kinds: [KIND.join], authors: bots, limit: 2000 },
      { kinds: [KIND.zap], "#p": bots, limit: 2000 },
    ],
    (event) => {
      botEvents.set(event.id, event);
      paint();
    },
  );
}
/** A player's record: a trusted rater's where it has one, else computed from what this page has. */
function recordOf(pubkey: string): Reliability {
  const said = asserted().get(pubkey)?.reliability;
  if (said) return said;
  const events = [...botEvents.values()];
  return reliability(
    pubkey,
    {
      lobbies: [...lobbies.values()],
      joins: events.filter((event) => event.kind === KIND.join),
      zaps: zap.zaps(events.filter((event) => event.kind === KIND.zap)),
      verdicts: audited().results,
    },
    nowSec(),
  );
}
export const wallet = () =>
  DEV_WALLET && window.webln ? "the dev wallet (play money)" : walletName();
export const nameOf = (pubkey: string) => who(pubkey).name || shortKey(pubkey);
const profileName = (pubkey: string) => who(pubkey).name;

/** Jester games from other clients, read from public relays once the lobby is first shown. */
const jesterEvents = new Map<string, GameEvent>();
type JesterFeed = { net: Net; games: JesterGame[]; starts: string; stopMoves: () => void };
let jester: JesterFeed | undefined;
let jesterTimer: ReturnType<typeof setTimeout> | undefined;
function followJester() {
  if (jester) return;
  const net = new Net(JESTER_RELAYS, signer);
  const feed: JesterFeed = (jester = { net, games: [], starts: "", stopMoves() {} });
  const add = (event: GameEvent) => {
    jesterEvents.set(event.id, event);
    clearTimeout(jesterTimer);
    jesterTimer = setTimeout(() => {
      feed.games = jesterGames([...jesterEvents.values()]);
      const starts = feed.games.map((game) => game.id).join();
      if (starts !== feed.starts) {
        feed.starts = starts;
        feed.stopMoves();
        feed.stopMoves = feed.net.subscribe(
          [{ kinds: [JESTER_KIND], "#e": starts.split(","), limit: 2000 }],
          add,
        );
        const players = feed.games.flatMap((game) => [game.white ?? [], game.black ?? []].flat());
        feed.net.fetch([{ kinds: [KIND.profile], authors: [...new Set(players)] }]).then(
          (events) => events.forEach(keep),
          () => {},
        );
      }
      paint();
    }, 300);
  };
  feed.net.subscribe([{ kinds: [JESTER_KIND], "#e": [START_REF], limit: 40 }], add);
}

/** My newest kind 0, from the relay or what this page already has. */
export async function ownProfile(): Promise<GameEvent | undefined> {
  const fetched = await net.fetch([{ kinds: [KIND.profile], authors: [me] }]);
  fetched.forEach(keep);
  return profiles.get(me);
}
/** Publishes my kind 0 with the edits merged into the newest one, so other apps' fields stay. */
export async function saveProfile(edits: ProfileEdits) {
  const old = await ownProfile();
  const tags = (old?.tags ?? []).filter(([name, value]) => !(name === "t" && value === TOPIC));
  keep(
    await net.publish({
      kind: KIND.profile,
      created_at: Math.max(nowSec(), (old?.created_at ?? 0) + 1),
      tags: [...tags, ["t", TOPIC]],
      content: mergeProfile(old?.content, edits),
    }),
  );
}

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
function addAssertion(event: GameEvent) {
  const key = `${event.pubkey}:${tagValue(event, "d")}`;
  if ((assertions.get(key)?.created_at ?? -1) < event.created_at) assertions.set(key, event);
  rated = undefined;
}
if (RATERS.length)
  net.subscribe([{ kinds: [KIND.rating], authors: RATERS, "#t": [TOPIC] }], (event) => {
    addAssertion(event);
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
  addLobby(event);
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
    joinBy: Number(tagValue(event, "expiration")),
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

/** The ranked humans, best first: bots are rated, not ranked. */
const ranks = () =>
  [...ratingTable()]
    .filter(([pubkey]) => !isBot(pubkey))
    .flatMap(([pubkey, speeds]) =>
      Object.entries(speeds).map(([speed, rating]) => ({ pubkey, speed: speed as Speed, rating })),
    )
    .sort((a, b) => b.rating.r - a.rating.r);

/**
 * Walks a relay query back in time, a page at a time, into the maps the live subscriptions fill,
 * so a list page shows more than their capped queries return.
 */
function pager(filter: Filter, add: (event: GameEvent) => void, size = 100) {
  const seen = new Set<string>();
  let until: number | null = null;
  let state: "idle" | "loading" | "done" = "idle";
  return {
    get state() {
      return state;
    },
    more() {
      if (state !== "idle") return;
      state = "loading";
      net.fetch([{ ...filter, limit: size, ...(until === null ? {} : { until }) }]).then(
        (page) => {
          const next = nextPage(page, size, seen);
          for (const event of page) {
            seen.add(event.id);
            add(event);
          }
          until = next.until;
          state = next.done ? "done" : "idle";
          paint();
        },
        () => {
          state = "idle";
          paint();
        },
      );
    },
  };
}
const pagers = new Map<string, ReturnType<typeof pager>>();
const paged = (key: string, filter: Filter, add: (event: GameEvent) => void) =>
  pagers.get(key) ?? pagers.set(key, pager(filter, add)).get(key)!;
const addNote = (event: GameEvent) => {
  notes.set(event.id, event);
  checkSoon();
};
const addLobby = (event: GameEvent) => {
  const key = address(event.pubkey, tagValue(event, "d") ?? "");
  if ((lobbies.get(key)?.created_at ?? -1) < event.created_at) lobbies.set(key, event);
};
const archivePages = () => paged("archives", { kinds: [KIND.archive], "#t": [TOPIC] }, addNote);
const sourcesOf = (kind: ListKind, pubkey: string) =>
  kind === "player"
    ? [paged(`archives:${pubkey}`, { kinds: [KIND.archive], "#p": [pubkey] }, addNote)]
    : kind === "games"
      ? [archivePages()]
      : kind === "leaderboard"
        ? [
            archivePages(),
            ...(RATERS.length
              ? [
                  paged(
                    "assertions",
                    { kinds: [KIND.rating], authors: RATERS, "#t": [TOPIC] },
                    addAssertion,
                  ),
                ]
              : []),
          ]
        : [paged("lobbies", { kinds: [KIND.game], "#t": [TOPIC] }, addLobby)];

/** How many rows the lobby and a player's page show before "Show all". */
export const FIRST_PAGE = 10;
export type ListKind = "games" | "live" | "open" | "leaderboard" | "player";
export type ListModel = {
  kind: ListKind;
  pubkey: string;
  results: Verdict[];
  live: (Seek & { guest: string })[];
  seeks: Seek[];
  ranks: { pubkey: string; speed: Speed; rating: Rating }[];
  loading: boolean;
  done: boolean;
};
/** A whole list on its own page, which asks the relay for older items as it is scrolled. */
function list(kind: ListKind, pubkey = ""): Route {
  const sources = sourcesOf(kind, pubkey);
  const more = () => sources.forEach((source) => source.more());
  more();
  return {
    name: "list",
    view() {
      const finished = audited().results.filter((verdict) => verdict.result !== "*");
      const { live, seeks } = games();
      return {
        kind,
        pubkey,
        results: kind === "player" ? finished.filter((v) => v.players.includes(pubkey)) : finished,
        live,
        seeks: seeks.filter((seek) => !seek.mine),
        ranks: kind === "leaderboard" ? ranks() : [],
        loading: sources.some((source) => source.state === "loading"),
        done: sources.every((source) => source.state === "done"),
      };
    },
    act(action) {
      if (action === "more") more();
    },
    leave() {},
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
  /** Jester games from other clients, unchecked, untimed and unrated. */
  jester: JesterGame[];
  ranks: { pubkey: string; speed: Speed; rating: Rating }[];
  /** The time control of a quick seek on its way to the relay. */
  pending: string | null;
  /**
   * `sats` is a bot's price a game, `plays` whether it takes the terms picked, `record` how it has
   * kept its challenges, and `capped` whether it asks more than the cap for bots without a record.
   */
  bots: {
    pubkey: string;
    rating?: Rating;
    sats: number;
    plays: boolean;
    record: string;
    capped: boolean;
    /** From its status event: offline, or online with how many of its tables are free. */
    status: { online: boolean; free: number; max: number };
  }[];
  newBotCap: number;
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
  followJester();
  let tc = localStorage.getItem("nochess:tc") ?? "300+3";
  if (!speedOf(tc)) tc = "300+3";
  let rated = localStorage.getItem("nochess:rated") !== "0";
  let level = Number(localStorage.getItem("nochess:level") ?? 3);
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
        own.set(gameId, new Table(net, me, gameId, localStorage, () => paint(), profileName));
    for (const [gameId, table] of own) {
      if (mine.some((seek) => seek.gameId === gameId)) continue;
      table.close();
      own.delete(gameId);
      if (tagValue(lobbies.get(address(me, gameId))!, "status") === "playing")
        location.hash = `#/${me}/${gameId}`;
    }
  }

  function start(challenged?: string) {
    const fee = challenged ? who(challenged).fee?.msat : 0;
    const wait = !challenged
      ? WAIT.seek
      : !isBot(challenged)
        ? WAIT.challenge
        : fee
          ? WAIT.paidBot
          : WAIT.bot;
    openGame(net, localStorage, { tc, rated }, challenged, wait).then(
      (gameId) => (location.hash = `#/${me}/${gameId}`),
      (reason) => {
        error = `The relay didn't take the game: ${reason instanceof Error ? reason.message : reason}`;
        paint();
      },
    );
  }
  const save = () => {
    localStorage.setItem("nochess:tc", tc);
    localStorage.setItem("nochess:rated", rated ? "1" : "0");
    localStorage.setItem("nochess:level", String(level));
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
        results: results.filter((verdict) => verdict.result !== "*"),
        checking,
        doubted,
        jester: jester?.games ?? [],
        ranks: ranks(),
        bots: [...profiles.keys()].filter(isBot).map((pubkey) => {
          const sats = (who(pubkey).fee?.msat ?? 0) / 1000;
          const record = recordOf(pubkey);
          return {
            pubkey,
            rating: table.get(pubkey)?.[speedOf(tc)!],
            sats,
            plays: covers(who(pubkey), { tc, rated }),
            record: describeReliability(record, true),
            capped: unproven(record) && sats > settings.newBotCap,
            status: readStatus(statuses.get(pubkey), nowSec()),
          };
        }),
        newBotCap: settings.newBotCap,
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
        else void saveProfile({ lud16: value });
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
  const table = new Table(net, host, gameId, localStorage, () => paint(), profileName);
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
  /** How the player has started and kept its games. */
  record: string;
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
      games: audited().results.filter((v) => v.result !== "*" && v.players.includes(pubkey)),
      record: describeReliability(recordOf(pubkey), isBot(pubkey)),
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
  const loaded = import("@nochess/core/engine/uci.ts").then(({ Engine, LEVELS, workerPipe }) => ({
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
  const [hash, anchor] = location.hash.split(/(?!^)#/);
  const level = Number(hash.match(/^#\/computer\/([1-8])$/)?.[1]);
  const { host, gameId, relay } = parseGameLink(hash);
  if (relay && /^wss?:\/\//.test(relay) && relay !== net.url) {
    followRelayHint(relay);
    return location.reload();
  }
  const [, shown, all] = hash.match(/^#\/player\/([0-9a-f]{64})(\/games)?$/) ?? [];
  const [, listed] = hash.match(/^#\/(games(?:\/live|\/open)?|leaderboard)$/) ?? [];
  const kinds: Record<string, ListKind> = {
    games: "games",
    "games/live": "live",
    "games/open": "open",
    leaderboard: "leaderboard",
  };
  const home = hash === "" || hash === "#" || hash === "#/";
  route = level
    ? computer(level)
    : all
      ? list("player", shown)
      : listed
        ? list(kinds[listed])
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
  if (anchor) reveal(anchor);
}

/** Scrolls to a section of the page once its lazily loaded route has rendered it. */
function reveal(id: string, tries = 0) {
  const section = document.getElementById(id);
  if (section) section.scrollIntoView({ behavior: "smooth" });
  else if (tries < 120) requestAnimationFrame(() => reveal(id, tries + 1));
}

/** `timed`: the relay advertises that it refuses moves stamped more than a few seconds off. */
export const status = () => ({
  online: net.online,
  relay: net.url,
  timed: timed(net.window, KIND.move),
});

/** The player's relays, and whether this tab follows a share link's instead. */
export const relays = () => ({ list: savedRelays(), shared: sharedRelay() });
/** Changes the player's relays; reconnects when the relay to use first is another. False if refused. */
export function editRelay(edit: RelayEdit, url: string): boolean {
  const list = editRelays(savedRelays(), edit, url);
  if (!list) return false;
  const reconnect = sharedRelay() || list[0] !== net.url;
  saveRelays(list);
  if (reconnect) location.reload();
  else paint();
  return true;
}

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
