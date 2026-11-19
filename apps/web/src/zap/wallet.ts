import { hexToBytes } from "@noble/hashes/utils.js";
import type { Filter } from "nostr-tools/filter";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, type NostrEvent } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";

const NWC_STORE = "nochess:nwc";
const NWC = { info: 13194, request: 23194, response: 23195 };

declare global {
  interface Window {
    webln?: { enable(): Promise<unknown>; sendPayment(invoice: string): Promise<unknown> };
  }
}

/** The wallet's key, its relay and this client's secret, from a `nostr+walletconnect://` URI. */
function parseConnectionString(uri: string) {
  const { protocol, host, pathname, searchParams } = new URL(uri);
  const [pubkey, relay, secret] = [
    host || pathname.replace(/^\/+/, ""),
    searchParams.get("relay"),
    searchParams.get("secret"),
  ];
  if (
    protocol !== "nostr+walletconnect:" ||
    !relay ||
    !/^[0-9a-f]{64}$/.test(`${secret}`) ||
    !/^[0-9a-f]{64}$/.test(pubkey)
  )
    throw new Error("not a Nostr Wallet Connect URI");
  return { pubkey, relay, secret: secret! };
}

export const nwcUri = () => localStorage.getItem(NWC_STORE) ?? "";
/** Keeps a `nostr+walletconnect://` URI, or forgets it when empty; false if it isn't one. */
export function setNwc(uri: string): boolean {
  try {
    if (uri) parseConnectionString(uri);
    localStorage.setItem(NWC_STORE, uri);
    return true;
  } catch {
    return false;
  }
}
export const walletName = () =>
  window.webln ? "your WebLN wallet" : nwcUri() ? "Nostr Wallet Connect" : "";

/** Pays with the user's wallet. False if they have none, so the invoice has to be shown. */
export async function pay(bolt11: string): Promise<boolean> {
  if (window.webln) {
    await window.webln.enable();
    await window.webln.sendPayment(bolt11);
  } else if (nwcUri()) await nwcPay(nwcUri(), bolt11);
  else return false;
  return true;
}

const first = (relay: Relay, filter: Filter, ms: number, stored: boolean) =>
  new Promise<NostrEvent | null>((resolve) => {
    const done = (event: NostrEvent | null) => {
      clearTimeout(timer);
      sub.close();
      resolve(event);
    };
    const timer = setTimeout(() => done(null), ms);
    const sub = relay.subscribe([filter], {
      onevent: done,
      oneose: () => stored && done(null),
    });
  });

/** NIP-47 `pay_invoice`, encrypted with NIP-44 when the wallet says it reads it, else NIP-04. */
export async function nwcPay(uri: string, bolt11: string) {
  const { pubkey, relay: url, secret } = parseConnectionString(uri);
  const key = hexToBytes(secret);
  const relay = await Relay.connect(url);
  try {
    const info = await first(relay, { kinds: [NWC.info], authors: [pubkey] }, 4000, true);
    const modern = info?.tags.find((tag) => tag[0] === "encryption")?.[1]?.includes("nip44_v2");
    const shared = nip44.getConversationKey(key, pubkey);
    const request = finalizeEvent(
      {
        kind: NWC.request,
        created_at: Math.floor(Date.now() / 1000),
        content: ((text) =>
          modern ? nip44.encrypt(text, shared) : nip04.encrypt(key, pubkey, text))(
          JSON.stringify({ method: "pay_invoice", params: { invoice: bolt11 } }),
        ),
        tags: [["p", pubkey], ...(modern ? [["encryption", "nip44_v2"]] : [])],
      },
      key,
    );
    const answer = first(
      relay,
      { kinds: [NWC.response], authors: [pubkey], "#e": [request.id] },
      60_000,
      false,
    );
    await relay.publish(request);
    const response = await answer;
    if (!response) throw new Error("The wallet did not answer.");
    const { error } = JSON.parse(
      modern
        ? nip44.decrypt(response.content, shared)
        : nip04.decrypt(key, pubkey, response.content),
    );
    if (error) throw new Error(`The wallet refused: ${error.message ?? error.code}`);
  } finally {
    relay.close();
  }
}
