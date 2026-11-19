// The bot account: a key of its own that accepts challenges over the relay and answers with
// Stockfish. Its games are ordinary games, so they are archived, audited and rated like any other.
import { Engine, ENGINE } from "../src/engine/uci.ts";
import { address, KIND, tagValue, TOPIC } from "../src/game/events.ts";
import { turnOf } from "../src/game/replay.ts";
import { Table } from "../src/game/table.ts";
import { connect, enginePipe, nowSec, RELAY, short } from "./node.ts";

const SKILL = Number(process.env.LUFT_BOT_SKILL ?? 20);
const MOVE_MS = Number(process.env.LUFT_BOT_MS ?? 300);
const NAME = process.env.LUFT_BOT_NAME ?? "Luftbot";

const net = connect("bot");
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
  if (game.phase === "open" && table.loaded) table.join();
  const turn = `${game.addr}:${game.sans.length}`;
  if (game.phase === "playing" && table.seat() === turnOf(game) && !asked.has(turn)) {
    asked.add(turn);
    thinking = thinking.then(async () => {
      const { best } = await engine.go(game.fen, `movetime ${MOVE_MS}`);
      table.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    });
  }
  if (game.phase === "finished" && tables.get(game.addr) === table) {
    console.log(`${game.addr.slice(-8)} ${game.result} by ${game.termination}`);
    tables.delete(game.addr);
    setTimeout(() => table.close(), 5000);
  }
}

await net.publish({
  kind: KIND.profile,
  created_at: nowSec(),
  tags: [["t", TOPIC]],
  content: JSON.stringify({
    name: NAME,
    about: `${ENGINE}, skill ${SKILL}, ${MOVE_MS} ms a move. Challenge me on Luft.`,
    bot: true,
  }),
});
const seen = new Set<string>();
net.subscribe([{ kinds: [KIND.game], "#p": [net.signer.pubkey], "#t": [TOPIC] }], (event) => {
  const gameId = tagValue(event, "d") ?? "";
  const addr = address(event.pubkey, gameId);
  if (seen.has(addr) || tagValue(event, "status") !== "open") return;
  if (Number(tagValue(event, "expiration")) < nowSec()) return;
  seen.add(addr);
  console.log(`challenge ${addr.slice(-8)} from ${short(event.pubkey)}, ${tagValue(event, "tc")}`);
  const table: Table = new Table(net, event.pubkey, gameId, store, () => step(table));
  tables.set(addr, table);
});
console.log(`bot ${NAME} ${net.signer.pubkey} ready on ${RELAY}`);
