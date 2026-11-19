import "./style.css";
import { Chess } from "chess.js";
import { Engine, LEVELS, workerPipe } from "./engine/uci.ts";
import { audit, type Verdict } from "./game/archive.ts";
import {
  address,
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
} from "./game/events.ts";
import { ratings } from "./game/glicko.ts";
import type { Seat } from "./game/replay.ts";
import { openGame, Table } from "./game/table.ts";
import {
  followRelayHint,
  gameLink,
  importKey,
  loadSigner,
  parseGameLink,
  parsePubkey,
  relayUrl,
} from "./nostr/browser.ts";
import { Net } from "./nostr/net.ts";
import { isPromotion, position, targets } from "./ui/board.ts";
import {
  type Board,
  computerOutcome,
  computerView,
  FEE_RULE,
  gameView,
  homeView,
  type Moves,
  profileView,
  REVIEW_RULE,
  type Seek,
  sheetView,
  shell,
  shortKey,
} from "./ui/render.ts";
import { payUrl } from "./zap/lnurl.ts";
import { zapper } from "./zap/sheet.ts";
import { setNwc, walletName } from "./zap/wallet.ts";

/** What the board needs from a game: its moves, my side, and a way to play. */
type Play = {
  sans(): string[];
  seat(): Seat | null;
  open(): boolean;
  move(from: string, to: string, promotion?: string): boolean;
};
type Route = {
  view(): string;
  act(action: string, target: HTMLElement): void;
  change?(target: HTMLInputElement | HTMLSelectElement): void;
  submit?(form: string, value: string): void;
  leave(): void;
  play?: Play;
};
type Drag = { from: string; x: number; y: number; ghost: HTMLElement | null; was: boolean };

const LIVE_FOR = 6 * 60 * 60;
/** Who gets the platform's share of a zap: both set, or there is no share. */
const PLATFORM: { pubkey: string; lud16: string } | null =
  import.meta.env.VITE_PLATFORM_PUBKEY && import.meta.env.VITE_PLATFORM_LUD16
    ? { pubkey: import.meta.env.VITE_PLATFORM_PUBKEY, lud16: import.meta.env.VITE_PLATFORM_LUD16 }
    : null;
const DEV_WALLET: string = import.meta.env.VITE_DEV_WALLET ?? "";
if (DEV_WALLET) (await import("./zap/devwallet.ts")).install(DEV_WALLET);
const app = document.querySelector<HTMLElement>("#app")!;
const root = document.documentElement;
const nowSec = () => Math.floor(Date.now() / 1000);

const signer = await loadSigner();
const me = signer.pubkey;
const net = new Net(relayUrl(), signer, () => paint());
const profiles = new Map<string, GameEvent>();
const wanted = new Set<string>();
let asking: string[] = [];
const keep = (event: GameEvent) => {
  if ((profiles.get(event.pubkey)?.created_at ?? -1) < event.created_at)
    profiles.set(event.pubkey, event);
  paint();
};
/** A profile without Luft's topic tag, a human's from another client, is asked for once it is shown. */
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
const who = (pubkey: string): Profile => {
  if (pubkey === PLATFORM?.pubkey) return { ...NOBODY, name: "Luft", lud16: PLATFORM.lud16 };
  const event = profiles.get(pubkey);
  if (!event) need(pubkey);
  return event ? profileOf(event) : NOBODY;
};
const isBot = (pubkey: string) => who(pubkey).bot;
net.subscribe([{ kinds: [KIND.profile], "#t": [TOPIC] }], keep);
const zap = zapper(net, who, PLATFORM?.pubkey ?? null, () => paint());
const wallet = () => (DEV_WALLET && window.webln ? "the dev wallet (play money)" : walletName());
const nameOf = (pubkey: string) => who(pubkey).name || shortKey(pubkey);

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
let rated: { key: string; table: ReturnType<typeof ratings> } | undefined;
function ratingTable() {
  const { results } = audited();
  const key = `${results.length}|${profiles.size}`;
  if (rated?.key !== key) rated = { key, table: ratings(results, isBot) };
  return rated.table;
}
const rate = (pubkey: string, speed: Speed) => ratingTable().get(pubkey)?.[speed];

let route: Route | undefined;
let painted = "";
/** Board state that outlives a repaint: the piece in hand, the move being looked at, a premove. */
let view = fresh();
function fresh() {
  return {
    ply: null as number | null,
    flip: false,
    selected: null as string | null,
    premove: null as [string, string] | null,
    promoting: null as [string, string] | null,
    plies: 0,
    drag: null as Drag | null,
  };
}

function paint() {
  if (!route) return;
  if (route.play) sync(route.play);
  const html = shell(
    route.view(),
    { online: net.online, relay: net.url, dark: root.dataset.theme === "dark" },
    zap.sheet ? sheetView(zap.sheet, who, PLATFORM?.pubkey ?? null, wallet()) : "",
  );
  if (html === painted) return;
  painted = html;
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement && app.contains(active) ? active : null;
  const unfolded = [...app.querySelectorAll("details")].map((d) => [d.className, d.open] as const);
  app.innerHTML = html;
  for (const [name, open] of unfolded) {
    const details =
      name && app.querySelector<HTMLDetailsElement>(`details.${name.split(" ").join(".")}`);
    if (details) details.open = open;
  }
  const input = typing && app.querySelector<HTMLInputElement>(`input[name="${typing.name}"]`);
  if (input) {
    input.value = typing.value;
    input.focus();
  }
  const list = app.querySelector<HTMLElement>(".moves");
  const on = list?.querySelector<HTMLElement>(".on");
  if (list && on)
    list.scrollTo({
      top: on.offsetTop - list.clientHeight / 2,
      left: on.offsetLeft - list.clientWidth / 2,
    });
  clocks();
}

function clocks() {
  for (const clock of app.querySelectorAll<HTMLElement>(".clock")) {
    const ms = clock.dataset.due
      ? Math.max(0, Number(clock.dataset.due) - Date.now())
      : Number(clock.dataset.left) * 1000;
    const left = Math.ceil(ms / 1000);
    clock.textContent =
      left >= 86_400
        ? `${Math.floor(left / 86_400)} d ${Math.floor((left % 86_400) / 3600)} h`
        : left >= 3600
          ? `${Math.floor(left / 3600)} h ${Math.floor((left % 3600) / 60)} min`
          : clock.dataset.due && ms < 10_000
            ? `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`
            : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    clock.classList.toggle("low", left <= 10);
  }
}

const liveFen = (play: Play) => position(play.sans(), play.sans().length).fen;
const myTurn = (play: Play) =>
  play.open() && play.seat() !== null && play.sans().length % 2 === play.seat();

/** After a move arrives: drop what no longer fits, and play a premove that is now legal. */
function sync(play: Play) {
  const plies = play.sans().length;
  if (plies === view.plies) return;
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

function boardOf(play: Play): Board & { moves: Moves } {
  const sans = play.sans();
  const ply = view.ply ?? sans.length;
  const { fen, last, check } = position(sans, ply);
  const seat = play.seat();
  const live = ply === sans.length;
  const selected = live && play.open() ? view.selected : null;
  return {
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
    moves: { sans, ply },
  };
}

/** A move from the hand to `to`, or a premove when it isn't my turn yet. */
function drop(play: Play, from: string, to: string): void {
  const seat = play.seat()!;
  const fen = liveFen(play);
  view.selected = null;
  if (!targets(fen, from, seat).includes(to)) return pick(play, to);
  if (!myTurn(play)) view.premove = [from, to];
  else if (isPromotion(fen, from, to)) view.promoting = [from, to];
  else play.move(from, to);
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
    return drop(play, selected, square);
  view.premove = null;
  view.selected =
    selected !== square && targets(liveFen(play), square, seat).length ? square : null;
}

function navigateMoves(to: string, ply?: number) {
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
}

function home(): Route {
  const lobbies = new Map<string, GameEvent>();
  let tc = localStorage.getItem("luft:tc") ?? "300+3";
  if (!speedOf(tc)) tc = "300+3";
  let rated = localStorage.getItem("luft:rated") !== "0";
  let level = Number(localStorage.getItem("luft:level") ?? 3);
  let error = "";

  const stop = net.subscribe([{ kinds: [KIND.game], "#t": [TOPIC], limit: 300 }], (event) => {
    const key = address(event.pubkey, tagValue(event, "d") ?? "");
    if ((lobbies.get(key)?.created_at ?? -1) < event.created_at) lobbies.set(key, event);
    paint();
  });
  const refresh = setInterval(paint, 20_000);

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
    view() {
      const { results, doubted } = audited();
      const table = ratingTable();
      return homeView({
        me,
        source: signer.source,
        who,
        rate,
        ...games(),
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
        wallet: wallet(),
      });
    },
    act(action, target) {
      if (action === "quick") {
        tc = target.dataset.tc!;
        save();
        const waiting = games().seeks.find(
          (seek) => seek.tc === tc && seek.rated === rated && !seek.mine && !seek.forMe,
        );
        if (waiting) location.hash = `#/${waiting.host}/${waiting.gameId}`;
        else start();
      } else if (action === "create") start();
      else if (action === "challenge-bot") start(target.dataset.pubkey);
    },
    change(target) {
      if (target.name === "tc" && speedOf(target.value)) tc = target.value;
      else if (target.name === "rated") rated = (target as HTMLInputElement).checked;
      else if (target.name === "level") level = Number(target.value);
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
      stop();
      clearInterval(refresh);
    },
  };
}

function game(host: string, gameId: string): Route {
  const table = new Table(net, host, gameId, localStorage, () => paint());
  let copied = false;
  let joining = false;
  let confirming = false;
  let unconfirm: ReturnType<typeof setTimeout> | undefined;
  const shareUrl = () => location.origin + location.pathname + gameLink(host, gameId, net.url);
  const play: Play = {
    sans: () => table.game.sans,
    seat: () => table.seat(),
    open: () => table.game.phase === "playing",
    move: (from, to, promotion) => table.move({ from, to, promotion }),
  };

  return {
    play,
    view() {
      const { game } = table;
      const players: string[] = game.players ?? [];
      const { moves, ...board } = boardOf(play);
      const zaps = zap.zaps(table.receipts).filter((z) => z.addr === table.addr);
      const botFee = game.challenged ? who(game.challenged).fee : null;
      const answered = new Set(table.labels.map((label) => tagValue(label, "e")));
      return gameView({
        game,
        me,
        seat: table.seat(),
        loaded: table.loaded,
        board,
        moves,
        who,
        rate,
        shareUrl: shareUrl(),
        copied,
        joining,
        confirming: confirming && table.game.phase === "playing",
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
      });
    },
    act(action, target) {
      clearTimeout(unconfirm);
      confirming = false;
      const service = action === "pay-fee" ? table.game.challenged! : target.dataset.pubkey!;
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
      else if (action === "join") {
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
      paint();
    },
    leave: () => table.close(),
  };
}

/** The services that review a game for a price. */
const reviewers = () =>
  [...profiles.keys()].flatMap((pubkey) => {
    const { fee } = who(pubkey);
    return fee?.role === "review" && fee.msat ? [[pubkey, fee] as const] : [];
  });

function profile(pubkey: string): Route {
  const receipts = new Map<string, GameEvent>();
  const stop = net.subscribe([{ kinds: [KIND.zap], "#p": [pubkey], limit: 200 }], (event) => {
    receipts.set(event.id, event);
    paint();
  });
  return {
    view: () =>
      profileView({
        pubkey,
        me,
        who,
        ratings: ratingTable().get(pubkey) ?? {},
        zaps: zap
          .zaps(receipts.values())
          .filter((z) => z.to === pubkey)
          .sort((a, b) => b.at - a.at),
        games: audited()
          .results.filter((v) => v.result !== "*" && v.players.includes(pubkey))
          .slice(0, 20),
      }),
    act() {},
    leave: stop,
  };
}

function computer(level: number): Route {
  const { skill, ms } = LEVELS[level - 1];
  const engine = new Engine(
    workerPipe(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`),
    skill,
  );
  let chess = new Chess();
  let seat: Seat = 0;
  let thinking = false;

  async function reply() {
    const game = chess;
    if (chess.isGameOver() || chess.turn() === "wb"[seat]) return;
    thinking = true;
    paint();
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
    play,
    view() {
      const { moves, ...board } = boardOf(play);
      return computerView({
        board,
        moves,
        level,
        seat,
        outcome: chess.isGameOver()
          ? computerOutcome(chess.isCheckmate(), chess.turn() === "w" ? 1 : 0)
          : null,
        thinking,
      });
    },
    act(action) {
      if (action === "again") restart(seat);
      else if (action === "swap") restart((1 - seat) as Seat);
      paint();
    },
    leave: () => engine.close(),
  };
}

function navigate() {
  route?.leave();
  zap.act("zap-close", app);
  view = fresh();
  const level = Number(location.hash.match(/^#\/computer\/([1-8])$/)?.[1]);
  const { host, gameId, relay } = parseGameLink(location.hash);
  if (relay && /^wss?:\/\//.test(relay) && relay !== net.url) {
    followRelayHint(relay);
    return location.reload();
  }
  const [, shown] = location.hash.match(/^#\/player\/([0-9a-f]{64})$/) ?? [];
  route = level ? computer(level) : shown ? profile(shown) : host ? game(host, gameId) : home();
  paint();
}

/** Board-level actions any route with a board shares; true if handled. */
function boardAction(action: string, target: HTMLElement): boolean {
  const play = route?.play;
  if (action === "theme") {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("luft:theme", root.dataset.theme);
  } else if (action === "zap") {
    const to = target.dataset.to!.split(",");
    zap.open({
      title: `Zap ${to.map(nameOf).join(" and ")}`,
      to,
      addr: target.dataset.addr || undefined,
    });
  } else if (zap.act(action === "zap-dismiss" ? "zap-close" : action, target)) {
    // the sheet took it
  } else if (!play) return false;
  else if (action === "flip") view.flip = !view.flip;
  else if (action === "nav") navigateMoves(target.dataset.to!);
  else if (action === "ply") navigateMoves("ply", Number(target.dataset.ply));
  else if (action === "promote" && view.promoting) {
    const [from, to] = view.promoting;
    view.promoting = null;
    play.move(from, to, target.dataset.piece);
  } else if (action === "promote-cancel") view.promoting = null;
  else return false;
  paint();
  return true;
}

app.addEventListener("click", (event) => {
  const element = event.target as HTMLElement;
  const square = element.closest<HTMLElement>(".sq");
  // Mouse and touch go through the pointer handlers; a click without a pointer is the keyboard.
  if (square && !element.closest(".promotion")) {
    if (event.detail === 0 && route?.play) {
      pick(route.play, square.dataset.square!);
      paint();
    }
    return;
  }
  const target = element.closest<HTMLElement>("[data-action]");
  if (!target || (target as HTMLButtonElement).disabled) return;
  if (/^(promote-cancel|zap-dismiss)$/.test(target.dataset.action!) && target !== element) return;
  if (!boardAction(target.dataset.action!, target)) route?.act(target.dataset.action!, target);
});

app.addEventListener("pointerdown", (event) => {
  const square = (event.target as HTMLElement).closest<HTMLElement>(".sq");
  const play = route?.play;
  if (!square || !play || event.button !== 0 || (event.target as HTMLElement).closest(".promotion"))
    return;
  event.preventDefault();
  const name = square.dataset.square!;
  const seat = play.seat();
  const mine =
    seat !== null && view.ply === null && play.open() && targets(liveFen(play), name, seat).length;
  const into = view.selected && targets(liveFen(play), view.selected, seat ?? 0).includes(name);
  if (mine && !into) {
    view.drag = {
      from: name,
      x: event.clientX,
      y: event.clientY,
      ghost: null,
      was: view.selected === name,
    };
    view.selected = name;
    view.premove = null;
    view.promoting = null;
  } else pick(play, name);
  paint();
});

window.addEventListener("pointermove", (event) => {
  const drag = view.drag;
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    const from = app.querySelector<HTMLElement>(`[data-square="${drag.from}"]`);
    const piece = from?.querySelector<HTMLElement>(".piece");
    if (!from || !piece) return void (view.drag = null);
    drag.ghost = Object.assign(document.createElement("i"), {
      className: `${piece.className} ghost`,
    });
    drag.ghost.style.width = drag.ghost.style.height = `${from.offsetWidth}px`;
    document.body.append(drag.ghost);
    paint();
  }
  drag.ghost.style.translate = `${event.clientX - drag.ghost.offsetWidth / 2}px ${event.clientY - drag.ghost.offsetHeight / 2}px`;
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest(".sq");
  for (const square of app.querySelectorAll(".sq.over"))
    if (square !== over) square.classList.remove("over");
  over?.classList.add("over");
});

window.addEventListener("pointerup", (event) => {
  const drag = view.drag;
  const play = route?.play;
  if (!drag || !play) return;
  view.drag = null;
  drag.ghost?.remove();
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".sq")
    ?.dataset.square;
  if (drag.ghost && over && over !== drag.from) drop(play, drag.from, over);
  else if (!drag.ghost && drag.was) view.selected = null;
  paint();
});
window.addEventListener("pointercancel", () => {
  view.drag?.ghost?.remove();
  view.drag = null;
  paint();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.metaKey || event.ctrlKey || event.altKey || !route?.play) return;
  const to = {
    ArrowLeft: "prev",
    ArrowRight: "next",
    ArrowUp: "first",
    Home: "first",
    ArrowDown: "last",
    End: "last",
  }[event.key];
  if (to) navigateMoves(to);
  else if (event.key === "f") view.flip = !view.flip;
  else if (event.key === "Escape")
    Object.assign(view, { selected: null, premove: null, promoting: null });
  else return;
  event.preventDefault();
  paint();
});

app.addEventListener("change", (event) => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
  if (zap.set(target.name, Number(target.value))) paint();
  else route?.change?.(target);
});
app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const [value] = new FormData(form).values();
  route?.submit?.(form.dataset.form ?? "", String(value ?? "").trim());
});
window.addEventListener("hashchange", navigate);
setInterval(clocks, 100);
navigate();
