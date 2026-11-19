// A stand-in Lightning provider for development and the tests. No money moves: it serves
// LNURL-pay for any name@127.0.0.1:<port>, issues regtest invoices no wallet will pay, and when
// told an invoice was paid (POST /pay, or NIP-47 pay_invoice) publishes the NIP-57 receipt a real
// provider would, signed by the nostrPubkey its pay endpoint names.
import { createServer } from "node:http";
import { text } from "node:stream/consumers";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { makeZapReceipt, validateZapRequest } from "nostr-tools/nip57";
import { generateSecretKey } from "nostr-tools/pure";
import { hashHex, tagValue } from "../packages/core/src/game/events.ts";
import { keySigner, Net } from "../packages/core/src/nostr/net.ts";
import { fakeInvoice } from "../packages/core/src/zap/bolt11.ts";
import { nowSec, RELAY, secretOf } from "./node.ts";

const PORT = Number(process.env.LUFT_ZAP_PORT ?? 7779);
const BASE = `http://127.0.0.1:${PORT}`;
const secret = secretOf("zapmock");
const net = new Net(RELAY, keySigner(secret));
const me = net.signer.pubkey;
const node = generateSecretKey();
const invoices = new Map<string, { request: string; preimage: string; paid: boolean }>();

/** Marks an invoice paid and publishes its receipt, once. Only to its own relay, whatever the request names. */
async function settle(bolt11: string): Promise<string | null> {
  const invoice = invoices.get(bolt11);
  if (!invoice) return null;
  if (!invoice.paid) {
    invoice.paid = true;
    const { request: zapRequest, preimage } = invoice;
    await net.publish(makeZapReceipt({ zapRequest, bolt11, preimage, paidAt: new Date() }));
  }
  return invoice.preimage;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  const reply = (body: unknown, status = 200) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    });
    res.end(JSON.stringify(body));
  };
  const [, path, name] =
    url.pathname.match(/^\/(\.well-known\/lnurlp|invoice)\/([a-z0-9._-]+)$/) ?? [];
  if (req.method === "OPTIONS") reply({});
  else if (path === "invoice") {
    const msat = Number(url.searchParams.get("amount"));
    const nostr = url.searchParams.get("nostr") ?? "";
    const reason =
      validateZapRequest(nostr) ??
      (msat >= 1000 && String(msat) === tagValue(JSON.parse(nostr), "amount")
        ? null
        : "The amount is under one sat or differs from the zap request.");
    if (reason) return reply({ status: "ERROR", reason });
    const preimage = randomBytes(32);
    const pr = fakeInvoice(msat, hashHex(nostr), preimage, node, nowSec());
    invoices.set(pr, { request: nostr, preimage: bytesToHex(preimage), paid: false });
    reply({ pr, routes: [] });
  } else if (name)
    reply({
      tag: "payRequest",
      callback: `${BASE}/invoice/${name}`,
      minSendable: 1000,
      maxSendable: 100_000_000,
      metadata: JSON.stringify([
        ["text/plain", `Play money for ${name}`],
        ["text/identifier", `${name}@127.0.0.1:${PORT}`],
      ]),
      allowsNostr: true,
      nostrPubkey: me,
    });
  else if (req.method === "POST" && url.pathname === "/pay") {
    const { invoice } = JSON.parse(await text(req));
    const preimage = await settle(invoice);
    reply(preimage ? { preimage } : { error: "unknown invoice" }, preimage ? 200 : 404);
  } else reply({ error: "not found" }, 404);
}).listen(PORT, "127.0.0.1");

// The same play-money wallet over Nostr Wallet Connect, for any client key.
net.subscribe([{ kinds: [23194], "#p": [me], since: nowSec() }], async (event) => {
  const modern = tagValue(event, "encryption") === "nip44_v2";
  const shared = nip44.getConversationKey(secret, event.pubkey);
  const { method, params } = JSON.parse(
    modern
      ? nip44.decrypt(event.content, shared)
      : nip04.decrypt(secret, event.pubkey, event.content),
  );
  const preimage = method === "pay_invoice" ? await settle(params.invoice) : null;
  const answer = JSON.stringify({
    result_type: method,
    ...(preimage
      ? { result: { preimage } }
      : { error: { code: "PAYMENT_FAILED", message: "not an invoice of this mock" } }),
  });
  await net.publish({
    kind: 23195,
    created_at: nowSec(),
    content: modern ? nip44.encrypt(answer, shared) : nip04.encrypt(secret, event.pubkey, answer),
    tags: [
      ["p", event.pubkey],
      ["e", event.id],
    ],
  });
});
await net.publish({
  kind: 13194,
  created_at: nowSec(),
  content: "pay_invoice",
  tags: [["encryption", "nip44_v2 nip04"]],
});
console.log(`zap mock ${me} ready on ${BASE}, receipts to ${RELAY}
play-money NWC: nostr+walletconnect://${me}?relay=${encodeURIComponent(RELAY)}&secret=<any 64 hex digits>`);
