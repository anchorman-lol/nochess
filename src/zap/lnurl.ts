import { utf8ToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import type { VerifiedEvent } from "nostr-tools/pure";
import { hashHex } from "../game/events.ts";
import { decodeInvoice } from "./bolt11.ts";

/** A recipient's LNURL-pay endpoint that takes zaps. Amounts are millisats. */
export type PayPoint = {
  callback: string;
  min: number;
  max: number;
  /** The key that signs this provider's zap receipts. */
  nostrPubkey: string;
  lnurl: string;
};
type Address = { lud16: string; lud06: string };

/** Where a lightning address (LUD-16) or an lnurl (LUD-06) is served. Plain http only for onion and loopback hosts. */
export function payUrl({ lud16, lud06 }: Address): string | null {
  const [, name, host] = lud16.toLowerCase().match(/^([a-z0-9._-]+)@([a-z0-9.-]+(?::\d+)?)$/) ?? [];
  if (name) {
    const plain = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) || host.endsWith(".onion");
    return `${plain ? "http" : "https"}://${host}/.well-known/lnurlp/${name}`;
  }
  try {
    const url = new TextDecoder().decode(bech32.decodeToBytes(lud06.toLowerCase(), false).bytes);
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** The pay endpoint of a profile, or null if it has none or the provider doesn't do zaps. */
export async function payPoint(address: Address): Promise<PayPoint | null> {
  const url = payUrl(address);
  if (!url) return null;
  const body = await (await fetch(url)).json();
  if (body.allowsNostr !== true || !/^[0-9a-f]{64}$/.test(body.nostrPubkey) || !body.callback)
    return null;
  return {
    callback: String(body.callback),
    min: Number(body.minSendable),
    max: Number(body.maxSendable),
    nostrPubkey: body.nostrPubkey,
    lnurl: bech32.encode("lnurl", bech32.toWords(utf8ToBytes(url)), false),
  };
}

/** Fetches the invoice for a signed zap request and refuses one that isn't for it. */
export async function invoiceFor(point: PayPoint, request: VerifiedEvent, msat: number) {
  const nostr = JSON.stringify(request);
  const url = new URL(point.callback);
  url.searchParams.set("amount", String(msat));
  url.searchParams.set("nostr", nostr);
  url.searchParams.set("lnurl", point.lnurl);
  const body = await (await fetch(url)).json();
  const invoice = decodeInvoice(String(body.pr ?? ""));
  if (invoice?.msat !== msat || invoice.descriptionHash !== hashHex(nostr))
    throw new Error(body.reason ?? "The provider's invoice is not for this zap.");
  return body.pr as string;
}
