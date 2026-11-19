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
  handle?: Subscription;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One relay connection that reconnects and reopens its subscriptions. Runs in browsers and Node. */
export class Net {
  online = false;
  readonly url: string;
  readonly signer: Signer;
  private onStatus: () => void;
  private relay?: Relay;
  private subs = new Set<Sub>();
  private closed = false;

  constructor(url: string, signer: Signer, onStatus: () => void = () => {}) {
    this.url = url;
    this.signer = signer;
    this.onStatus = onStatus;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
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
    } catch {
      this.setOnline(false);
      await sleep(1500);
      return this.connect();
    }
  }

  private setOnline(online: boolean) {
    this.online = online;
    this.onStatus();
  }

  private open(relay: Relay, sub: Sub) {
    sub.handle = relay.subscribe(sub.filters, { onevent: sub.onEvent, oneose: sub.onEose });
  }

  private async ready(): Promise<Relay> {
    for (let waited = 0; !this.relay && waited < 10_000; waited += 100) await sleep(100);
    if (!this.relay) throw new Error(`no connection to ${this.url}`);
    return this.relay;
  }

  subscribe(filters: Filter[], onEvent: Sub["onEvent"], onEose?: () => void): () => void {
    const sub: Sub = { filters, onEvent, onEose };
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
