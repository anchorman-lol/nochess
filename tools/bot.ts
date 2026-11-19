// The bot account: a key of its own that accepts challenges over the relay and answers with
// Stockfish. Its games are ordinary games, so they are archived, audited and rated like any other.
// With LUFT_BOT_PRICE (sats) it joins a challenge only once a valid zap receipt pays for it. A
// challenge it can't take (other terms, all tables in use, a relay that refuses the game's
// subscription) it declines at once rather than letting it wait out its time.
import { Engine, ENGINE } from "../packages/core/src/engine/uci.ts";
import {
  address,
  build,
  covers,
  KIND,
  profileOf,
  tagValue,
  termsOf,
  TOPIC,
} from "../packages/core/src/game/events.ts";
import { turnOf } from "../packages/core/src/game/replay.ts";
import { sessionKey, Table } from "../packages/core/src/game/table.ts";
import { payment } from "../packages/core/src/zap/fee.ts";
import { readZap, type Zap } from "../packages/core/src/zap/zap.ts";
import { connect, enginePipe, fileStore, nowSec, RELAY, servicePoint, short } from "./node.ts";

const SKILL = Number(process.env.LUFT_BOT_SKILL ?? 20);
const MOVE_MS = Number(process.env.LUFT_BOT_MS ?? 300);
const NAME = process.env.LUFT_BOT_NAME ?? "Nochess bot";
const PRICE = Number(process.env.LUFT_BOT_PRICE ?? 0) * 1000;
/** Each table is a subscription, and relays cap them per connection (anchorman at 20). */
const MAX_TABLES = Number(process.env.LUFT_BOT_TABLES ?? 15);
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

const id = process.env.LUFT_BOT_ID ?? "bot";
const net = connect(id);
const me = net.signer.pubkey;
/** Checked zaps to this bot, and the receipts its joins have spent. */
const zaps = new Map<string, Zap>();
const spent = new Set<string>();
const expiry = new Map<string, number>();
const joined = new Set<string>();
let ledger = !point;
const engine = new Engine(enginePipe(), SKILL);
const store = fileStore(`.keys/${id}-sessions.json`);
const tables = new Map<string, Table>();
const asked = new Set<string>();
const declined = new Set<string>();
let thinking: Promise<unknown> = Promise.resolve();

/** Publishes the bot's NIP-38 status when its free tables change, and at least every minute. */
let said = "";
function report(online = true, force = false) {
  const free = Math.max(0, MAX_TABLES - tables.size);
  if (!force && said === `${online}:${free}`) return Promise.resolve();
  said = `${online}:${free}`;
  return net
    .publish(build.status({ online, free, max: MAX_TABLES, msat: PRICE }, nowSec()))
    .catch(console.error);
}

function decline(host: string, addr: string, reason: string) {
  if (declined.has(addr)) return;
  declined.add(addr);
  console.log(`declined ${addr.slice(-8)} from ${short(host)}: ${reason}`);
  net.publish(build.decline(addr, host, reason, nowSec())).catch(console.error);
}

function step(table: Table) {
  const { game } = table;
  if (table.refused && tables.get(game.addr) === table) {
    console.log(`${game.addr.slice(-8)} refused by the relay: ${table.refused}`);
    if (!joined.has(game.addr)) decline(game.host, game.addr, "busy");
    tables.delete(game.addr);
    void report();
    return table.close();
  }
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
    void report();
    store.forget(game.addr);
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
  const open = tagValue(event, "status") === "open" && expires >= nowSec();
  const resumed = tagValue(event, "status") === "playing" && store.getItem(sessionKey(addr));
  if (open) expiry.set(addr, expires);
  if (tables.has(addr) || !(resumed || open)) return;
  if (resumed) joined.add(addr);
  else if (!covers(profile, termsOf(event))) return decline(event.pubkey, addr, "terms");
  else if (tables.size >= MAX_TABLES) return decline(event.pubkey, addr, "busy");
  console.log(
    `${resumed ? "resuming" : "challenge"} ${addr.slice(-8)} from ${short(event.pubkey)}, ${tagValue(event, "tc")}`,
  );
  const table: Table = new Table(net, event.pubkey, gameId, store, () => step(table));
  tables.set(addr, table);
  void report();
});
// A challenge nobody paid for lapses with its seek.
setInterval(() => {
  for (const [addr, table] of tables)
    if (table.game.phase === "open" && expiry.get(addr)! < nowSec()) {
      tables.delete(addr);
      void report();
      table.close();
    }
}, 30_000);
void report(true, true);
setInterval(() => void report(true, true), 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    const exit = () => process.exit(0);
    setTimeout(exit, 2000);
    void report(false, true).then(exit);
  });
console.log(`bot ${NAME} ${me} ready on ${RELAY}${PRICE ? `, ${PRICE / 1000} sats a game` : ""}`);
