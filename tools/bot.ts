// The bot account: a key of its own that accepts challenges over the relay and answers with
// Stockfish. Its games are ordinary games, so they are archived, audited and rated like any other.
// With LUFT_BOT_PRICE (sats) it joins a challenge only once a valid zap receipt pays for it.
import { Engine, ENGINE } from "../src/engine/uci.ts";
import { address, covers, KIND, profileOf, tagValue, termsOf, TOPIC } from "../src/game/events.ts";
import { turnOf } from "../src/game/replay.ts";
import { Table } from "../src/game/table.ts";
import { payment } from "../src/zap/fee.ts";
import { readZap, type Zap } from "../src/zap/zap.ts";
import { connect, enginePipe, nowSec, RELAY, servicePoint, short } from "./node.ts";

const SKILL = Number(process.env.LUFT_BOT_SKILL ?? 20);
const MOVE_MS = Number(process.env.LUFT_BOT_MS ?? 300);
const NAME = process.env.LUFT_BOT_NAME ?? "Luftbot";
const PRICE = Number(process.env.LUFT_BOT_PRICE ?? 0) * 1000;
const modes = (process.env.LUFT_BOT_MODES ?? "rated,casual").split(",");
const content = JSON.stringify({
  name: NAME,
  about: `${ENGINE}, skill ${SKILL}, ${MOVE_MS} ms a move. Challenge me on Luft.`,
  bot: true,
  lud16: process.env.LUFT_BOT_LUD16,
  luft: {
    role: "bot",
    price_msat: PRICE,
    speeds: process.env.LUFT_BOT_SPEEDS?.split(","),
    rated: modes.includes("rated"),
    casual: modes.includes("casual"),
  },
});
const profile = profileOf({ content });
const point = PRICE ? await servicePoint(profile.lud16) : null;

const net = connect(process.env.LUFT_BOT_ID ?? "bot");
const me = net.signer.pubkey;
/** Checked zaps to this bot, and the receipts its joins have spent. */
const zaps = new Map<string, Zap>();
const spent = new Set<string>();
const expiry = new Map<string, number>();
const joined = new Set<string>();
let ledger = !point;
const engine = new Engine(enginePipe(), SKILL);
const memory = new Map<string, string>();
const store = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
};
const tables = new Map<string, Table>();
const asked = new Set<string>();
let thinking: Promise<unknown> = Promise.resolve();

function step(table: Table) {
  const { game } = table;
  if (game.phase === "open" && table.loaded && ledger && !joined.has(game.addr)) {
    const paid = PRICE
      ? payment([...zaps.values()], spent, { addr: game.addr, payer: game.host, price: PRICE })
      : null;
    if (paid) spent.add(paid.id);
    if (paid || !PRICE) {
      joined.add(game.addr);
      table.join(paid?.id);
    }
  }
  const turn = `${game.addr}:${game.sans.length}`;
  if (game.phase === "playing" && table.seat() === turnOf(game) && !asked.has(turn)) {
    asked.add(turn);
    thinking = thinking.then(async () => {
      const { best } = await engine.go(game.fen, `movetime ${MOVE_MS}`);
      table.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    });
  }
  const over = game.phase === "finished" || game.phase === "cancelled";
  if (over && tables.get(game.addr) === table) {
    console.log(
      `${game.addr.slice(-8)} ${game.result ? `${game.result} by ${game.termination}` : "withdrawn"}`,
    );
    tables.delete(game.addr);
    setTimeout(() => table.close(), 5000);
  }
}

await net.publish({ kind: KIND.profile, created_at: nowSec(), tags: [["t", TOPIC]], content });
if (point)
  net.subscribe(
    [
      { kinds: [KIND.zap], "#p": [me] },
      { kinds: [KIND.join], authors: [me] },
    ],
    (event) => {
      const zap = event.kind === KIND.zap ? readZap(event, point.nostrPubkey) : null;
      if (zap?.to === me) zaps.set(zap.id, zap);
      const paidBy = event.pubkey === me && tagValue(event, "e");
      if (paidBy) spent.add(paidBy);
      for (const table of tables.values()) step(table);
    },
    () => {
      ledger = true;
      for (const table of tables.values()) step(table);
    },
  );
net.subscribe([{ kinds: [KIND.game], "#p": [me], "#t": [TOPIC] }], (event) => {
  const gameId = tagValue(event, "d") ?? "";
  const addr = address(event.pubkey, gameId);
  const expires = Number(tagValue(event, "expiration"));
  if (tagValue(event, "status") !== "open" || expires < nowSec()) return;
  expiry.set(addr, expires);
  if (tables.has(addr) || !covers(profile, termsOf(event))) return;
  console.log(`challenge ${addr.slice(-8)} from ${short(event.pubkey)}, ${tagValue(event, "tc")}`);
  const table: Table = new Table(net, event.pubkey, gameId, store, () => step(table));
  tables.set(addr, table);
});
// A challenge nobody paid for lapses with its seek.
setInterval(() => {
  for (const [addr, table] of tables)
    if (table.game.phase === "open" && expiry.get(addr)! < nowSec()) {
      tables.delete(addr);
      table.close();
    }
}, 30_000);
console.log(`bot ${NAME} ${me} ready on ${RELAY}${PRICE ? `, ${PRICE / 1000} sats a game` : ""}`);
