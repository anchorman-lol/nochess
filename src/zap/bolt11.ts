import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { decode } from "light-bolt11-decoder";

export type Invoice = { msat: number; descriptionHash: string; paymentHash: string };

/** What a zap needs from a BOLT11 invoice; null if it isn't one or names no amount. */
export function decodeInvoice(bolt11: string): Invoice | null {
  try {
    const sections: { name: string; value?: unknown }[] = decode(bolt11).sections;
    const value = (name: string) => sections.find((section) => section.name === name)?.value;
    const msat = Number(value("amount"));
    const [descriptionHash, paymentHash] = [value("description_hash"), value("payment_hash")];
    if (!(msat > 0) || typeof descriptionHash !== "string" || typeof paymentHash !== "string")
      return null;
    return { msat, descriptionHash, paymentHash };
  } catch {
    return null;
  }
}

const words = (value: number, count: number) =>
  Array.from({ length: count }, (_, i) => Math.floor(value / 32 ** (count - 1 - i)) % 32);
const field = (tag: number, hex: string) => {
  const data = bech32.toWords(hexToBytes(hex));
  return [tag, ...words(data.length, 2), ...data];
};

/**
 * A regtest invoice no wallet will pay, for the mock provider and the tests: well-formed BOLT11
 * with the amount, the payment hash of `preimage` and the description hash, signed by `key`.
 */
export function fakeInvoice(
  msat: number,
  descriptionHash: string,
  preimage: Uint8Array,
  key: Uint8Array,
  now: number,
): string {
  const hrp = `lnbcrt${msat % 100 ? `${msat * 10}p` : `${msat / 100}n`}`;
  const data = [
    ...words(now, 7),
    ...field(1, bytesToHex(sha256(preimage))),
    ...field(23, descriptionHash),
  ];
  const bits = data.map((word) => word.toString(2).padStart(5, "0")).join("");
  const bytes = Uint8Array.from(
    bits.padEnd(Math.ceil(bits.length / 8) * 8, "0").match(/.{8}/g)!,
    (b) => parseInt(b, 2),
  );
  const signed = secp256k1.sign(sha256(concatBytes(utf8ToBytes(hrp), bytes)), key, {
    prehash: false,
    format: "recovered",
  });
  const signature = concatBytes(signed.slice(1), signed.slice(0, 1));
  return bech32.encode(hrp, [...data, ...bech32.toWords(signature)], false);
}
