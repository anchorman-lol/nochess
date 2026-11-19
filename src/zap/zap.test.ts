import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { makeZapReceipt } from "nostr-tools/nip57";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { expect, test } from "vitest";
import { covers, type GameEvent, hashHex, profileOf, type Template } from "../game/events.ts";
import { decodeInvoice, fakeInvoice } from "./bolt11.ts";
import { owed, payment } from "./fee.ts";
import { payUrl } from "./lnurl.ts";
import { readZap, split, zapRequest } from "./zap.ts";

const keys = [0, 1, 2, 3].map(() => generateSecretKey());
const [PAYER, BOT, PROVIDER, OTHER] = keys.map((key) => getPublicKey(key));
const by = (who: number, template: Template): GameEvent => finalizeEvent(template, keys[who]);
const GAME = `30064:${PAYER}:g1`;
const PREIMAGE = hexToBytes("11".repeat(32));

/** A zap as an honest provider settles it; `change` tampers with the pieces first. */
function zap(
  msat: number,
  addr: string | null = GAME,
  change: { invoiceMsat?: number; hash?: string; signer?: number; from?: number; to?: string } = {},
) {
  const request = by(
    change.from ?? 0,
    zapRequest(
      {
        to: change.to ?? BOT,
        msat,
        relays: ["ws://relay"],
        addr: addr ?? undefined,
        comment: "gg",
      },
      100,
    ),
  );
  const description = JSON.stringify(request);
  const bolt11 = fakeInvoice(
    change.invoiceMsat ?? msat,
    change.hash ?? hashHex(description),
    PREIMAGE,
    keys[2],
    100,
  );
  return by(
    change.signer ?? 2,
    makeZapReceipt({ zapRequest: description, bolt11, paidAt: new Date(101_000) }),
  );
}

test("a fake invoice decodes to its amount and hashes", () => {
  for (const msat of [1000, 21_000, 2_100_000, 1234]) {
    const invoice = decodeInvoice(fakeInvoice(msat, "ab".repeat(32), PREIMAGE, keys[2], 100));
    expect(invoice).toEqual({
      msat,
      descriptionHash: "ab".repeat(32),
      paymentHash: bytesToHex(sha256(PREIMAGE)),
    });
  }
  expect(fakeInvoice(1000, "ab".repeat(32), PREIMAGE, keys[2], 100)).toMatch(/^lnbcrt/);
  expect(decodeInvoice("lnbc1notaninvoice")).toBeNull();
});

test("a receipt from the recipient's provider reads as a zap", () => {
  const event = zap(21_000);
  expect(readZap(event, PROVIDER)).toEqual({
    id: event.id,
    from: PAYER,
    to: BOT,
    msat: 21_000,
    addr: GAME,
    comment: "gg",
    at: 101,
    bolt11: expect.stringMatching(/^lnbcrt/),
  });
  expect(readZap(zap(5000, null), PROVIDER)?.addr).toBeNull();
});

test("a receipt signed by anyone but the provider's nostrPubkey is no zap", () => {
  expect(readZap(zap(21_000, GAME, { signer: 0 }), PROVIDER)).toBeNull();
  expect(readZap(zap(21_000), OTHER)).toBeNull();
  expect(readZap({ ...zap(21_000), sig: "00".repeat(64) }, PROVIDER)).toBeNull();
});

test("the invoice must commit to the zap request and carry its amount", () => {
  expect(readZap(zap(21_000, GAME, { hash: hashHex("another request") }), PROVIDER)).toBeNull();
  expect(readZap(zap(21_000, GAME, { invoiceMsat: 1000 }), PROVIDER)).toBeNull();
});

test("a receipt cannot be pointed at another recipient or game", () => {
  const event = zap(21_000);
  const retag = (name: string, value: string) =>
    by(2, { ...event, tags: event.tags.map((tag) => (tag[0] === name ? [name, value] : tag)) });
  expect(readZap(retag("p", OTHER), PROVIDER)).toBeNull();
  expect(readZap(retag("a", `30064:${OTHER}:g2`), PROVIDER)).toBeNull();
  const forged = JSON.stringify({ ...JSON.parse(event.tags.at(-1)![1]), pubkey: OTHER });
  expect(readZap(retag("description", forged), PROVIDER)).toBeNull();
});

test("a split is whole sats by weight, the remainder to the first, nothing dropped", () => {
  expect(split(100, [PAYER], OTHER, 5)).toEqual([
    { pubkey: PAYER, sats: 95 },
    { pubkey: OTHER, sats: 5 },
  ]);
  expect(split(21, [PAYER, BOT], OTHER, 5)).toEqual([
    { pubkey: PAYER, sats: 10 },
    { pubkey: BOT, sats: 10 },
    { pubkey: OTHER, sats: 1 },
  ]);
  expect(split(101, [PAYER, BOT], OTHER, 0)).toEqual([
    { pubkey: PAYER, sats: 51 },
    { pubkey: BOT, sats: 50 },
  ]);
});

test("a share too small for one sat goes to the players, and no platform means no share", () => {
  expect(split(10, [PAYER], OTHER, 5)).toEqual([{ pubkey: PAYER, sats: 10 }]);
  expect(split(100, [PAYER], null, 5)).toEqual([{ pubkey: PAYER, sats: 100 }]);
  expect(split(100, [PAYER], PAYER, 5)).toEqual([{ pubkey: PAYER, sats: 100 }]);
});

const paid = (msat: number, addr: string | null = GAME, from = 0) =>
  readZap(zap(msat, addr, { from }), PROVIDER)!;

test("a bot joins a challenge only on a receipt of at least its price for that game", () => {
  const want = { addr: GAME, payer: PAYER, price: 21_000 };
  expect(payment([], new Set(), want)).toBeNull();
  expect(payment([paid(20_000)], new Set(), want)).toBeNull();
  expect(payment([paid(21_000, null)], new Set(), want)).toBeNull();
  const exact = paid(21_000);
  expect(payment([exact], new Set(), want)).toBe(exact);
  expect(payment([exact], new Set([exact.id]), want)).toBeNull();
});

test("anyone may pay for a challenge, but only the payer's own unused receipt carries over", () => {
  const want = { addr: GAME, payer: PAYER, price: 21_000 };
  const sponsor = paid(21_000, GAME, 3);
  expect(payment([sponsor], new Set(), want)).toBe(sponsor);
  const earlier = paid(21_000, `30064:${PAYER}:old`);
  expect(payment([earlier], new Set(), want)).toBe(earlier);
  expect(payment([earlier], new Set([earlier.id]), want)).toBeNull();
  expect(payment([paid(21_000, `30064:${OTHER}:old`, 3)], new Set(), want)).toBeNull();
  const direct = paid(21_000);
  expect(payment([earlier, direct], new Set(), want)).toBe(direct);
});

test("a reviewer owes one review per unanswered receipt of at least its price", () => {
  const [low, tip, first, second] = [
    paid(1000),
    paid(50_000, null),
    paid(50_000),
    paid(60_000, `30064:${OTHER}:g2`, 3),
  ];
  expect(owed([low, tip, first, second], new Set(), 50_000)).toEqual([first, second]);
  expect(owed([first, second, first], new Set([first.id]), 50_000)).toEqual([second]);
  expect(owed([low], new Set(), 0)).toEqual([low]);
});

test("a lightning address or an lnurl names the pay endpoint, in the clear only on loopback", () => {
  const at = (lud16: string, lud06 = "") => payUrl({ lud16, lud06 });
  expect(at("Alice@wallet.example")).toBe("https://wallet.example/.well-known/lnurlp/alice");
  expect(at("a@127.0.0.1:7779")).toBe("http://127.0.0.1:7779/.well-known/lnurlp/a");
  const lnurl = bech32.encode("lnurl", bech32.toWords(utf8ToBytes("https://x.example/p")), false);
  expect(at("", lnurl.toUpperCase())).toBe("https://x.example/p");
  expect(at("not an address")).toBeNull();
  expect(at("", "lnurl1nonsense")).toBeNull();
});

test("a profile's fee block says what a service charges and which games it takes", () => {
  const luft = { role: "bot", price_msat: 21_000, speeds: ["blitz"], casual: false };
  const bot = profileOf({ content: JSON.stringify({ name: "B", bot: true, luft }) });
  expect(bot.fee).toEqual({
    role: "bot",
    msat: 21_000,
    speeds: ["blitz"],
    rated: true,
    casual: false,
  });
  expect(covers(bot, { tc: "300+3", rated: true })).toBe(true);
  expect(covers(bot, { tc: "300+3", rated: false })).toBe(false);
  expect(covers(bot, { tc: "900+10", rated: true })).toBe(false);
  const human = profileOf({ content: '{"name":"H","lud16":" h@wallet.example "}' });
  expect(human).toMatchObject({ lud16: "h@wallet.example", fee: null });
  expect(covers(human, { tc: "2d", rated: false })).toBe(true);
  const bank = { luft: { role: "bank", price_msat: 1 } };
  expect(profileOf({ content: JSON.stringify(bank) }).fee).toBeNull();
});
