import "./style.css";
import { Chess } from "chess.js";
import { Engine, LEVELS, workerPipe } from "./engine/uci.ts";
import { audit, type Verdict } from "./game/archive.ts";
import {
  address,
  type GameEvent,
  KIND,
  type Profile,
  profileOf,
  speedOf,
  type Speed,
  tagValue,
  termsOf,
  TOPIC,
} from "./game/events.ts";
import { ratings } from "./game/glicko.ts";
import { type Seat, turnOf } from "./game/replay.ts";
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
import {
  type Board,
  computerOutcome,
  computerView,
  gameView,
  homeView,
  type Seek,
  shell,
} from "./ui/render.ts";

type Route = {
  view(): string;
  act(action: string, target: HTMLElement): void;
  change?(target: HTMLInputElement | HTMLSelectElement): void;
  submit?(form: string, value: string): void;
  leave(): void;
};

const LIVE_FOR = 6 * 60 * 60;
const app = document.querySelector<HTMLElement>("#app")!;
const nowSec = () => Math.floor(Date.now() / 1000);

const signer = await loadSigner();
const me = signer.pubkey;
const net = new Net(relayUrl(), signer, () => paint());
const profiles = new Map<string, GameEvent>();
const who = (pubkey: string): Profile => {
  const event = profiles.get(pubkey);
  return event ? profileOf(event) : { name: "", bot: false };
};
net.subscribe([{ kinds: [KIND.profile], "#t": [TOPIC] }], (event) => {
  if ((profiles.get(event.pubkey)?.created_at ?? -1) < event.created_at)
    profiles.set(event.pubkey, event);
  paint();
});
let route: Route | undefined;
let painted = "";

function paint() {
  if (!route) return;
  const html = shell(route.view(), { online: net.online, relay: net.url });
  if (html === painted) return;
  painted = html;
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement && app.contains(active) ? active : null;
  const unfolded = [...app.querySelectorAll("details[open]")].map((details) => details.className);
  app.innerHTML = html;
  for (const name of unfolded) app.querySelector(`details.${name}`)?.setAttribute("open", "");
  const input = typing && app.querySelector<HTMLInputElement>(`input[name="${typing.name}"]`);
  if (input) {
    input.value = typing.value;
    input.focus();
  }
  clocks();
}

function clocks() {
  for (const clock of app.querySelectorAll<HTMLElement>(".clock")) {
    const left = clock.dataset.due
      ? Math.max(0, Math.ceil((Number(clock.dataset.due) - Date.now()) / 1000))
      : Number(clock.dataset.left);
    clock.textContent =
      left >= 86_400
        ? `${Math.floor(left / 86_400)} d ${Math.floor((left % 86_400) / 3600)} h`
        : left >= 3600
          ? `${Math.floor(left / 3600)} h ${Math.floor((left % 3600) / 60)} min`
          : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    clock.classList.toggle("low", left <= 10);
  }
}

/** Board state shared by a relay game and a game against the computer. */
function boardOf(sans: string[], seat: Seat | null, selected: string | null): Board {
  const chess = new Chess();
  const moves = sans.map((san) => chess.move(san));
  const last = moves.at(-1);
  return {
    fen: chess.fen(),
    flipped: seat === 1,
    selected,
    targets: selected
      ? chess.moves({ square: selected as never, verbose: true }).map((move) => move.to)
      : [],
    last: last ? [last.from, last.to] : [],
  };
}
const ownPiece = (fen: string, square: string, seat: Seat) =>
  new Chess(fen).get(square as never)?.color === "wb"[seat];

function home(): Route {
  const lobbies = new Map<string, GameEvent>();
  const notes = new Map<string, GameEvent>();
  const verdicts = new Map<string, Verdict | null>();
  let tc = localStorage.getItem("luft:tc") ?? "300+3";
  if (!speedOf(tc)) tc = "300+3";
  let rated = localStorage.getItem("luft:rated") !== "0";
  let level = Number(localStorage.getItem("luft:level") ?? 3);
  let error = "";
  let gone = false;
  let checking = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Audits one game at a time, so a long list never freezes the page. */
  async function check() {
    const games = Map.groupBy(notes.values(), (note) => tagValue(note, "a") ?? "");
    for (const [addr, group] of games) {
      const key = `${addr}|${group.length}`;
      if (verdicts.has(key) || gone) continue;
      verdicts.set(key, audit(group));
      paint();
      await new Promise((resolve) => setTimeout(resolve));
    }
    checking = false;
    paint();
  }
  const checkSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void check(), 200);
  };
  const stops = [
    net.subscribe([{ kinds: [KIND.game], "#t": [TOPIC], limit: 300 }], (event) => {
      const key = address(event.pubkey, tagValue(event, "d") ?? "");
      if ((lobbies.get(key)?.created_at ?? -1) < event.created_at) lobbies.set(key, event);
      paint();
    }),
    net.subscribe(
      [{ kinds: [KIND.archive], "#t": [TOPIC], limit: 120 }],
      (event) => {
        notes.set(event.id, event);
        checkSoon();
      },
      checkSoon,
    ),
  ];
  const refresh = setInterval(paint, 20_000);

  function start(challenged?: string) {
    openGame(net, localStorage, { tc, rated }, challenged).then(
      (gameId) => (location.hash = `#/${me}/${gameId}`),
      (reason) => {
        error = `The relay didn't take the game: ${reason instanceof Error ? reason.message : reason}`;
        paint();
      },
    );
  }

  return {
    view() {
      const now = nowSec();
      const games = Map.groupBy(notes.values(), (note) => tagValue(note, "a") ?? "");
      const audited = [...games].map(([addr, group]) => verdicts.get(`${addr}|${group.length}`));
      const results = audited
        .filter((verdict) => verdict != null)
        .sort((a, b) => b.endedAt - a.endedAt);
      const isBot = (pubkey: string) => who(pubkey).bot;
      const table = ratings(results, isBot);
      const all = [...lobbies.values()].map(
        (event): Seek & { event: GameEvent; guest: string } => ({
          event,
          host: event.pubkey,
          gameId: tagValue(event, "d") ?? "",
          ...termsOf(event),
          guest: tagValue(event, "p") ?? "",
          mine: event.pubkey === me,
          forMe: tagValue(event, "p") === me,
        }),
      );
      const status = (seek: (typeof all)[number]) => tagValue(seek.event, "status");
      return homeView({
        me,
        source: signer.source,
        who,
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
            !games.has(address(seek.host, seek.gameId)) &&
            (speedOf(seek.tc) === "correspondence" || seek.event.created_at > now - LIVE_FOR),
        ),
        results: results.filter((verdict) => verdict.result !== "*").slice(0, 30),
        checking,
        doubted: audited.filter((verdict) => verdict === null).length,
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
        bots: [...profiles.keys()]
          .filter(isBot)
          .map((pubkey) => ({ pubkey, rating: table.get(pubkey)?.[speedOf(tc)!] })),
        tc,
        rated,
        level,
        error,
      });
    },
    act(action, target) {
      if (action === "create") start();
      else if (action === "challenge-bot") start(target.dataset.pubkey);
    },
    change(target) {
      if (target.name === "tc" && speedOf(target.value)) tc = target.value;
      else if (target.name === "rated") rated = (target as HTMLInputElement).checked;
      else if (target.name === "level") level = Number(target.value);
      localStorage.setItem("luft:tc", tc);
      localStorage.setItem("luft:rated", rated ? "1" : "0");
      localStorage.setItem("luft:level", String(level));
      paint();
    },
    submit(form, value) {
      if (form === "challenge") {
        const pubkey = parsePubkey(value);
        if (pubkey && pubkey !== me) return start(pubkey);
        error = "That isn't another player's npub.";
      } else if (form === "key" && importKey(value)) return location.reload();
      else error = "That isn't a secret key: it should start with nsec1 or be 64 hex characters.";
      paint();
    },
    leave() {
      gone = true;
      for (const stop of stops) stop();
      clearInterval(refresh);
      clearTimeout(timer);
    },
  };
}

function game(host: string, gameId: string): Route {
  const table = new Table(net, host, gameId, localStorage, () => {
    if (table.game.sans.length !== plies) selected = null;
    plies = table.game.sans.length;
    paint();
  });
  let selected: string | null = null;
  let plies = 0;
  let copied = false;
  let joining = false;
  const shareUrl = () => location.origin + location.pathname + gameLink(host, gameId, net.url);

  return {
    view() {
      const players: string[] = table.game.players ?? [];
      return gameView({
        game: table.game,
        me,
        seat: table.seat(),
        loaded: table.loaded,
        board: boardOf(table.game.sans, table.seat(), selected),
        who,
        shareUrl: shareUrl(),
        copied,
        joining,
        signed: new Set(
          table.archives.map((note) => note.pubkey).filter((key) => players.includes(key)),
        ).size,
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
          };
        }),
      });
    },
    act(action, target) {
      const seat = table.seat();
      if (action === "join") {
        joining = true;
        table.join();
      } else if (action === "copy") {
        void navigator.clipboard?.writeText(shareUrl());
        copied = true;
        setTimeout(() => {
          copied = false;
          paint();
        }, 2500);
      } else if (action === "square") {
        const square = target.dataset.square!;
        const { game: at } = table;
        if (at.phase !== "playing" || seat === null || seat !== turnOf(at)) return;
        if (selected && table.move({ from: selected, to: square, promotion: "q" })) selected = null;
        else selected = ownPiece(at.fen, square, seat) && selected !== square ? square : null;
      } else if (action === "resign" || action === "abort" || action.startsWith("draw-"))
        table.act(action as "resign");
      paint();
    },
    leave: () => table.close(),
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
  let selected: string | null = null;
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
    selected = null;
    void reply();
  }

  return {
    view: () =>
      computerView({
        board: boardOf(chess.history(), seat, selected),
        level,
        seat,
        sans: chess.history(),
        outcome: chess.isGameOver()
          ? computerOutcome(chess.isCheckmate(), chess.turn() === "w" ? 1 : 0)
          : "",
        thinking,
      }),
    act(action, target) {
      if (action === "again") restart(seat);
      else if (action === "swap") restart((1 - seat) as Seat);
      else if (action === "square" && !thinking && !chess.isGameOver()) {
        const square = target.dataset.square!;
        try {
          if (!selected) throw new Error("nothing selected");
          chess.move({ from: selected, to: square, promotion: "q" });
          selected = null;
          void reply();
        } catch {
          selected = ownPiece(chess.fen(), square, seat) && selected !== square ? square : null;
        }
      }
      paint();
    },
    leave: () => engine.close(),
  };
}

function navigate() {
  route?.leave();
  const level = Number(location.hash.match(/^#\/computer\/([1-8])$/)?.[1]);
  const { host, gameId, relay } = parseGameLink(location.hash);
  if (relay && /^wss?:\/\//.test(relay) && relay !== net.url) {
    followRelayHint(relay);
    return location.reload();
  }
  route = level ? computer(level) : host ? game(host, gameId) : home();
  paint();
}

app.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (target && !(target as HTMLButtonElement).disabled) route?.act(target.dataset.action!, target);
});
app.addEventListener("change", (event) => {
  const { target } = event;
  if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement)
    route?.change?.(target);
});
app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const [value] = new FormData(form).values();
  route?.submit?.(form.dataset.form ?? "", String(value ?? "").trim());
});
window.addEventListener("hashchange", navigate);
setInterval(clocks, 250);
navigate();
