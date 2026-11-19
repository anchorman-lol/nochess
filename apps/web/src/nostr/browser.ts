import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as nip19 from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey, type VerifiedEvent } from "nostr-tools/pure";
import { KIND, type Template } from "@nochess/core/game/events.ts";
import { keySigner, type Signer } from "@nochess/core/nostr/net.ts";
import { RELAY_STORE, RELAYS_STORE, relaysFrom } from "./relays.ts";

const KEY_STORE = "nochess:key";
/** Ours first; the public ones keep the app playable while it is down. */
export const DEFAULT_RELAYS = import.meta.env.VITE_RELAY_URL
  ? [import.meta.env.VITE_RELAY_URL]
  : import.meta.env.PROD
    ? ["wss://relay.anchorman.lol", "wss://nos.lol", "wss://relay.damus.io"]
    : ["ws://127.0.0.1:7778"];

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: Template): Promise<VerifiedEvent>;
    };
  }
}

/** The NIP-07 extension if there is one and it agrees, else a key kept in this browser. */
export async function loadSigner(): Promise<Signer> {
  const extension = window.nostr;
  if (extension) {
    try {
      const pubkey = await extension.getPublicKey();
      return { pubkey, source: "extension", sign: (template) => extension.signEvent(template) };
    } catch {
      // the user declined the extension: fall back to a browser key
    }
  }
  let hex = localStorage.getItem(KEY_STORE);
  if (!hex) {
    hex = bytesToHex(generateSecretKey());
    localStorage.setItem(KEY_STORE, hex);
  }
  return keySigner(hexToBytes(hex));
}

/** Replaces the browser key with a pasted nsec or hex key; false if it is neither. */
export function importKey(text: string): boolean {
  try {
    const decoded = /^[0-9a-f]{64}$/.test(text) ? hexToBytes(text) : nip19.decode(text).data;
    if (!(decoded instanceof Uint8Array)) return false;
    getPublicKey(decoded);
    localStorage.setItem(KEY_STORE, bytesToHex(decoded));
    return true;
  } catch {
    return false;
  }
}

/** A pasted npub or hex public key, as hex; empty if it is neither. */
export function parsePubkey(text: string): string {
  if (/^[0-9a-f]{64}$/.test(text)) return text;
  try {
    const { type, data } = nip19.decode(text);
    return type === "npub" ? data : "";
  } catch {
    return "";
  }
}

export const relayUrls = () => relaysFrom(sessionStorage, localStorage, DEFAULT_RELAYS);
export const savedRelays = () => relaysFrom({ getItem: () => null }, localStorage, DEFAULT_RELAYS);
/** Whether this tab follows the relay a share link named, not the player's list. */
export const sharedRelay = () => Boolean(sessionStorage.getItem(RELAY_STORE));
/** Uses the relay a share link names, for this tab only. */
export const followRelayHint = (url: string) => sessionStorage.setItem(RELAY_STORE, url);
/** Saves the player's list, and lets this tab follow it again. */
export function saveRelays(list: string[]) {
  localStorage.setItem(RELAYS_STORE, JSON.stringify(list));
  localStorage.removeItem(RELAY_STORE);
  sessionStorage.removeItem(RELAY_STORE);
}

/** A link to a game that carries its relay, as a NIP-19 naddr. */
export const gameLink = (host: string, gameId: string, relay: string) =>
  `#/${nip19.naddrEncode({ kind: KIND.game, pubkey: host, identifier: gameId, relays: [relay] })}`;

export function parseGameLink(hash: string): { host: string; gameId: string; relay?: string } {
  const [, host, gameId] = hash.match(/^#\/([0-9a-f]{64})\/([0-9a-z-]{1,64})$/) ?? [];
  if (host) return { host, gameId };
  try {
    const { type, data } = nip19.decode(hash.slice(2));
    if (type === "naddr" && data.kind === KIND.game)
      return { host: data.pubkey, gameId: data.identifier, relay: data.relays?.[0] };
  } catch {
    // not a game link
  }
  return { host: "", gameId: "" };
}
