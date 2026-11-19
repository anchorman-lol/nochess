import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { Chess } from "chess.js";
import { generateSecretKey } from "nostr-tools/pure";
import { keySigner, type Net, type Signer } from "../nostr/net.ts";
import { archive } from "./archive.ts";
import {
  type Action,
  address,
  build,
  type GameEvent,
  hashHex,
  KIND,
  SEEK_TTL,
  tagValue,
  type Template,
  type Terms,
  termsOf,
} from "./events.ts";
import { type Game, replay, type Seat, seatOf, turnOf } from "./replay.ts";

/** Where a participant keeps its session key and salt: localStorage, or a Map for a bot. */
export type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const nowSec = () => Math.floor(Date.now() / 1000);
const sessionKey = (addr: string) => `luft:session:${addr}`;
const saltKey = (addr: string) => `luft:salt:${addr}`;

/** Opens a seek, or a challenge to one player, and returns its game id. */
export async function openGame(net: Net, store: Store, terms: Terms, challenged?: string) {
  const gameId = bytesToHex(randomBytes(4));
  const addr = address(net.signer.pubkey, gameId);
  const secret = generateSecretKey();
  const salt = bytesToHex(randomBytes(16));
  store.setItem(sessionKey(addr), bytesToHex(secret));
  store.setItem(saltKey(addr), salt);
  await net.publish(
    build.open(gameId, terms, keySigner(secret).pubkey, hashHex(salt), nowSec(), challenged),
  );
  return gameId;
}

/**
 * One game as one participant or spectator sees it. It follows the relay, replays what arrives and
 * does what a player's client owes the game without being asked: the host admits a guest, a
 * player claims a flag that has fallen and publishes the archive when the game is over.
 */
export class Table {
  game: Game;
  loaded = false;
  archives: GameEvent[] = [];
  labels: GameEvent[] = [];
  readonly addr: string;
  private net: Net;
  private store: Store;
  private onChange: () => void;
  private events = new Map<string, GameEvent>();
  private sent = new Set<string>();
  private stops: (() => void)[];

  constructor(net: Net, host: string, gameId: string, store: Store, onChange: () => void) {
    this.net = net;
    this.store = store;
    this.onChange = onChange;
    this.addr = address(host, gameId);
    this.game = replay([], host, gameId);
    const stop = net.subscribe(
      [
        { kinds: [KIND.game], authors: [host], "#d": [gameId] },
        {
          kinds: [KIND.join, KIND.move, KIND.action, KIND.archive, KIND.label],
          "#a": [this.addr],
          limit: 2000,
        },
      ],
      (event) => this.receive(event),
      () => {
        this.loaded = true;
        this.tick();
      },
    );
    const timer = setInterval(() => this.tick(), 1000);
    this.stops = [stop, () => clearInterval(timer)];
  }

  private get me() {
    return this.net.signer.pubkey;
  }

  private session(): Signer | null {
    const secret = this.store.getItem(sessionKey(this.addr));
    return secret ? keySigner(hexToBytes(secret)) : null;
  }

  /** My seat, if this device holds the session key the game names for me. */
  seat(): Seat | null {
    const seat = seatOf(this.game, this.me);
    return seat !== null && this.session()?.pubkey === this.game.sessions![seat] ? seat : null;
  }

  private receive(event: GameEvent) {
    if (this.events.has(event.id)) return;
    this.events.set(event.id, event);
    if (event.kind === KIND.archive) this.archives.push(event);
    if (event.kind === KIND.label) this.labels.push(event);
    this.tick();
  }

  /** Signs once and sends until the relay has it, so a retry can never become a second move. */
  private send(key: string, template: Template, signer: Signer) {
    if (this.sent.has(key)) return;
    this.sent.add(key);
    void signer.sign(template).then(async (event) => {
      for (let tries = 0; tries < 30; tries++) {
        try {
          return this.receive(await this.net.send(event));
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    });
  }

  private tick() {
    const game = (this.game = replay([...this.events.values()], this.game.host, this.game.gameId));
    const now = nowSec();
    const session = this.session();
    const lobby = [...this.events.values()].findLast((event) => event.kind === KIND.game);
    const salt = this.store.getItem(saltKey(this.addr));
    if (game.phase === "open" && game.host === this.me && session && salt && lobby && this.loaded) {
      const at = Math.max(now, lobby.created_at + 1);
      if (game.join)
        this.send(
          "playing",
          build.playing(game.gameId, game, session.pubkey, salt, game.join, at),
          this.net.signer,
        );
      else if (now - lobby.created_at > SEEK_TTL - 300)
        this.send(
          `open:${lobby.created_at}`,
          build.open(
            game.gameId,
            game,
            session.pubkey,
            hashHex(salt),
            at,
            game.challenged ?? undefined,
          ),
          this.net.signer,
        );
    }
    const seat = this.seat();
    if (seat !== null && session) {
      const flagged = game.deadline !== null && turnOf(game) !== seat && now > game.deadline + 1;
      if (game.phase === "playing" && flagged) this.act("claim-time");
      const mine = this.archives.some((note) => note.pubkey === this.me);
      if (game.phase === "finished" && game.result !== "*" && this.loaded && !mine)
        this.send("archive", archive(game, this.net.url, now), this.net.signer);
    }
    this.onChange();
  }

  /** Asks to join an open game under the terms and seed it shows. */
  join() {
    const lobby = [...this.events.values()].findLast((event) => event.kind === KIND.game);
    if (this.game.phase !== "open" || !lobby || this.sent.has("join")) return;
    const secret = generateSecretKey();
    this.store.setItem(sessionKey(this.addr), bytesToHex(secret));
    this.send(
      "join",
      build.join(
        this.addr,
        this.game.host,
        termsOf(lobby),
        keySigner(secret).pubkey,
        tagValue(lobby, "seed") ?? "",
        nowSec(),
      ),
      this.net.signer,
    );
  }

  /** Plays a move given as SAN or as squares; false if it isn't mine to make or isn't legal. */
  move(input: string | { from: string; to: string; promotion?: string }): boolean {
    const { game } = this;
    const session = this.session();
    if (game.phase !== "playing" || this.seat() !== turnOf(game) || !session) return false;
    try {
      const made = new Chess(game.fen).move(input);
      const ply = game.sans.length + 1;
      const at = Math.max(nowSec(), game.times.at(-1) ?? game.startedAt);
      const prev = game.ids.at(-1) ?? game.join!.id;
      this.send(`move:${ply}`, build.move(this.addr, ply, prev, made.san, made.after, at), session);
      return true;
    } catch {
      return false;
    }
  }

  act(action: Action) {
    const session = this.session();
    const ply = this.game.sans.length;
    if (this.game.phase !== "playing" || this.seat() === null || !session) return;
    this.send(`${action}:${ply}`, build.action(this.addr, ply, action, nowSec()), session);
  }

  close() {
    for (const stop of this.stops) stop();
  }
}
