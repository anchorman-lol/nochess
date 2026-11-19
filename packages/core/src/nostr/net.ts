import type { Filter } from "nostr-tools/filter";
import { finalizeEvent, getPublicKey, type VerifiedEvent } from "nostr-tools/pure";
import { Relay, type Subscription } from "nostr-tools/relay";
import type { GameEvent, Template } from "../game/events.ts";

export type Signer = {
  pubkey: string;
  source: "extension" | "key";
  sign(template: Template): Promise<VerifiedEvent>;
};

export const keySigner = (secret: Uint8Array): Signer => ({
  pubkey: getPublicKey(secret),
  source: "key",
  sign: async (template) => finalizeEvent(template, secret),
});

type Sub = {
  filters: Filter[];
  onEvent: (event: GameEvent) => void;
  onEose?: () => void;
  onRefused?: (reason: string) => void;
  handle?: Subscription;
};
/** Why nostr-tools closes a subscription itself, as against a relay's CLOSED. */
const OURS = /^(closed by caller|relay connection closed|<aborted>)/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * The `created_at` window a relay enforces, in seconds into the past and the future, from its
 * NIP-11 `limitation` as Sashité's self-timed relay profile writes it. `kinds` null covers every kind.
 */
export type TimeWindow = { past: number; future: number; kinds: number[] | null };
/** The most backdating a relay may allow and still be trusted with clocks, as in Sashité's client. */
const TIMED_PAST = 5;

export function timeWindowOf(info: unknown): TimeWindow | null {
  const limits = (info as { limitation?: Record<string, unknown> } | null)?.limitation;
  const past = limits?.created_at_lower_limit;
  if (typeof past !== "number") return null;
  const kinds = limits?.created_at_window_kinds;
  return {
    past,
    future: Number(limits?.created_at_upper_limit) || Infinity,
    kinds: Array.isArray(kinds) ? kinds.map(Number) : null,
  };
}
const covers = (window: TimeWindow, kind: number) => !window.kinds || window.kinds.includes(kind);
/** Whether the relay vouches for the `created_at` of this kind, so clocks built on it are honest. */
export const timed = (window: TimeWindow | null, kind: number) =>
  !!window && window.past <= TIMED_PAST && covers(window, kind);
/** Whether the relay would refuse this event as too old, which a fresh signature fixes. */
export const stale = (
  window: TimeWindow | null,
  event: { kind: number; created_at: number },
  now: number,
) => !!window && covers(window, event.kind) && event.created_at < now - window.past;

/**
 * One relay connection that reconnects and reopens its subscriptions. Runs in browsers and Node.
 * Given several relays it uses the first it can reach, and tries them in order again after a drop.
 */
export class Net {
  online = false;
  url: string;
  /** The current relay's `created_at` window, from its NIP-11 document; null if it has none. */
  window: TimeWindow | null = null;
  private urls: string[];
  readonly signer: Signer;
  private onStatus: () => void;
  private relay?: Relay;
  private subs = new Set<Sub>();
  private closed = false;

  constructor(urls: string | string[], signer: Signer, onStatus: () => void = () => {}) {
    this.urls = [urls].flat();
    this.url = this.urls[0];
    this.signer = signer;
    this.onStatus = onStatus;
    void this.connect();
  }

  private async connect(attempt = 0): Promise<void> {
    if (this.closed) return;
    this.url = this.urls[attempt % this.urls.length];
    try {
      const relay = await Relay.connect(this.url);
      relay.onclose = () => {
        this.relay = undefined;
        this.setOnline(false);
        void sleep(1500).then(() => this.connect());
      };
      this.relay = relay;
      for (const sub of this.subs) this.open(relay, sub);
      this.setOnline(true);
      void this.readInfo(this.url);
    } catch {
      this.setOnline(false);
      await sleep(1500);
      return this.connect(attempt + 1);
    }
  }

  private async readInfo(url: string) {
    this.window = null;
    try {
      const response = await fetch(url.replace(/^ws/, "http"), {
        headers: { Accept: "application/nostr+json" },
        signal: AbortSignal.timeout(5000),
      });
      const window = timeWindowOf(await response.json());
      if (url === this.url) this.window = window;
      this.onStatus();
    } catch {
      // a relay without a NIP-11 document has no window
    }
  }

  private setOnline(online: boolean) {
    this.online = online;
    this.onStatus();
  }

  private open(relay: Relay, sub: Sub) {
    sub.handle = relay.subscribe(sub.filters, {
      onevent: sub.onEvent,
      oneose: sub.onEose,
      onclose: (reason) => {
        if (!OURS.test(reason)) sub.onRefused?.(reason);
      },
    });
  }

  private async ready(): Promise<Relay> {
    for (let waited = 0; !this.relay && waited < 10_000; waited += 100) await sleep(100);
    if (!this.relay) throw new Error(`no connection to ${this.url}`);
    return this.relay;
  }

  /** `onRefused` hears a relay's CLOSED, such as a cap on subscriptions. */
  subscribe(
    filters: Filter[],
    onEvent: Sub["onEvent"],
    onEose?: () => void,
    onRefused?: (reason: string) => void,
  ): () => void {
    const sub: Sub = { filters, onEvent, onEose, onRefused };
    this.subs.add(sub);
    if (this.relay) this.open(this.relay, sub);
    return () => {
      this.subs.delete(sub);
      sub.handle?.close();
    };
  }

  /** What the relay has stored for the filters, as one closed query. */
  async fetch(filters: Filter[]): Promise<GameEvent[]> {
    const relay = await this.ready();
    return new Promise((resolve) => {
      const events: GameEvent[] = [];
      const sub = relay.subscribe(filters, {
        onevent: (event) => events.push(event),
        oneose: () => sub.close(),
        onclose: () => resolve(events),
      });
    });
  }

  /** Sends an event that is already signed; safe to repeat. */
  async send(event: VerifiedEvent): Promise<GameEvent> {
    const relay = await this.ready();
    try {
      await relay.publish(event);
    } catch (error) {
      if (!String(error).includes("auth-required")) throw error;
      await relay.auth((auth) => this.signer.sign(auth));
      await relay.publish(event);
    }
    return event;
  }

  publish = async (template: Template, signer = this.signer) =>
    this.send(await signer.sign(template));

  close() {
    this.closed = true;
    this.relay?.close();
  }
}

/**
 * Signs once and sends until the relay has it, so a retry never becomes a second event. Only
 * when the relay's window refuses the event as too old is the same template signed again with
 * the time now: same content, so for a move it is not a different move. A connection that knows
 * no window, such as a bot's shared one, just resends.
 */
export async function deliver(
  net: Pick<Net, "send"> & { window?: TimeWindow | null },
  template: Template,
  signer: Signer,
  wait = 2000,
): Promise<GameEvent | undefined> {
  let event = await signer.sign(template);
  for (let tries = 0; tries < 30; tries++) {
    try {
      return await net.send(event);
    } catch {
      if (stale(net.window ?? null, event, nowSec()))
        event = await signer.sign({ ...template, created_at: nowSec() });
      else await sleep(wait);
    }
  }
}
