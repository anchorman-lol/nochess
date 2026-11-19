import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey } from "nostr-tools/pure";
import type { Pipe } from "../src/engine/uci.ts";
import { auditAll } from "../src/game/archive.ts";
import { KIND, profileOf, TOPIC } from "../src/game/events.ts";
import { keySigner, Net } from "../src/nostr/net.ts";

export const RELAY = process.env.LUFT_RELAY ?? "ws://127.0.0.1:7778";
export const nowSec = () => Math.floor(Date.now() / 1000);
export const short = (pubkey: string) => pubkey.slice(0, 8);

/** The key of a service: LUFT_<NAME>_KEY, or a file under .keys/ that is made on first use. */
export function connect(name: string): Net {
  const file = `.keys/${name}.hex`;
  let hex = process.env[`LUFT_${name.toUpperCase()}_KEY`];
  if (!hex && existsSync(file)) hex = readFileSync(file, "utf8").trim();
  if (!hex) {
    hex = bytesToHex(generateSecretKey());
    mkdirSync(".keys", { recursive: true });
    writeFileSync(file, hex, { mode: 0o600 });
  }
  return new Net(RELAY, keySigner(hexToBytes(hex)));
}

/** Stockfish's WASM build as a child process that speaks UCI on its standard streams. */
export function enginePipe(): Pipe {
  const engine = spawn(process.execPath, [
    new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url).pathname,
  ]);
  return {
    post: (line) => engine.stdin.write(`${line}\n`),
    listen: (onLine) => createInterface({ input: engine.stdout }).on("line", onLine),
    close: () => engine.kill(),
  };
}

/** Every finished game the relay has an archive for, audited, and the keys that say they are bots. */
export async function finishedGames(net: Net) {
  const [notes, profiles] = await Promise.all([
    net.fetch([{ kinds: [KIND.archive], "#t": [TOPIC], limit: 2000 }]),
    net.fetch([{ kinds: [KIND.profile], "#t": [TOPIC] }]),
  ]);
  const bots = new Set(profiles.filter((event) => profileOf(event).bot).map((e) => e.pubkey));
  return { verdicts: auditAll(notes), bots };
}
