import { validateZapRequest } from "nostr-tools/nip57";
import { type Event, verifyEvent } from "nostr-tools/pure";
import { type GameEvent, hashHex, KIND, tagValue, type Template } from "../game/events.ts";
import { decodeInvoice } from "./bolt11.ts";

/** A zap receipt that held up: who paid whom how much, and the game it names, if any. */
export type Zap = {
  id: string;
  from: string;
  to: string;
  msat: number;
  addr: string | null;
  comment: string;
  at: number;
  bolt11: string;
};

/** A NIP-57 zap request for a player, with `addr` for a game. It goes to the LNURL callback, not to relays. */
export const zapRequest = (
  zap: {
    to: string;
    msat: number;
    relays: string[];
    lnurl?: string;
    addr?: string;
    comment?: string;
  },
  now: number,
): Template => ({
  kind: KIND.zapRequest,
  created_at: now,
  content: zap.comment ?? "",
  tags: [
    ["relays", ...zap.relays],
    ["amount", String(zap.msat)],
    ...(zap.lnurl ? [["lnurl", zap.lnurl]] : []),
    ["p", zap.to],
    ...(zap.addr ? [["a", zap.addr]] : []),
  ],
});

/**
 * Reads a kind 9735 receipt as NIP-57 appendix F asks. `nostrPubkey` is what the recipient's LNURL
 * endpoint names; a receipt signed by any other key is somebody's claim, not a payment. The
 * invoice must commit to the zap request (description hash) and carry the amount it asked for,
 * and the receipt may not name another recipient or game than the request did.
 */
export function readZap(receipt: GameEvent, nostrPubkey: string): Zap | null {
  try {
    const description = tagValue(receipt, "description") ?? "";
    const bolt11 = tagValue(receipt, "bolt11") ?? "";
    const invoice = decodeInvoice(bolt11);
    if (
      receipt.kind !== KIND.zap ||
      receipt.pubkey !== nostrPubkey ||
      !verifyEvent(structuredClone(receipt) as Event) ||
      validateZapRequest(description) !== null ||
      !invoice ||
      invoice.descriptionHash !== hashHex(description)
    )
      return null;
    const request: GameEvent = JSON.parse(description);
    const amount = tagValue(request, "amount");
    const same = (name: string) => tagValue(request, name) === tagValue(receipt, name);
    if (request.kind !== KIND.zapRequest || (amount && Number(amount) !== invoice.msat))
      return null;
    if (!same("p") || !same("a") || !same("e")) return null;
    return {
      id: receipt.id,
      from: request.pubkey,
      to: tagValue(request, "p")!,
      msat: invoice.msat,
      addr: tagValue(request, "a") ?? null,
      comment: request.content,
      at: receipt.created_at,
      bolt11,
    };
  } catch {
    return null;
  }
}

/**
 * Who gets how many sats of a zap. NIP-57 appendix G splits by weight with one zap per receiver,
 * so every line here becomes its own zap request and invoice. The platform's weight is `percent`,
 * the recipients share the rest equally; amounts are whole sats and the remainder goes to the
 * first recipient, so a share under one sat is no share.
 */
export function split(
  sats: number,
  recipients: string[],
  platform: string | null,
  percent: number,
): { pubkey: string; sats: number }[] {
  const share = platform && !recipients.includes(platform) ? Math.floor((sats * percent) / 100) : 0;
  const each = Math.floor((sats - share) / recipients.length);
  const parts = recipients.map((pubkey, i) => ({
    pubkey,
    sats: i ? each : sats - share - each * (recipients.length - 1),
  }));
  return [...parts, ...(share ? [{ pubkey: platform!, sats: share }] : [])];
}
