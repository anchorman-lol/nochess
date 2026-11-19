import { generateSecretKey } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { expect, test, vi } from "vitest";
import { deliver, keySigner, Net, stale, timed, timeWindowOf } from "./net.ts";

test("a relay that can't be reached gives way to the next one, and a drop starts again from the first", async () => {
  vi.useFakeTimers();
  const relay = { onclose: () => {}, subscribe: vi.fn(), close: vi.fn() };
  const tried: string[] = [];
  vi.spyOn(Relay, "connect").mockImplementation(async (url: string) => {
    tried.push(url);
    if (url === "wss://down.example") throw new Error("unreachable");
    return relay as unknown as Relay;
  });
  const net = new Net(["wss://down.example", "wss://up.example"], keySigner(generateSecretKey()));
  await vi.advanceTimersByTimeAsync(1500);
  expect(net.online).toBe(true);
  expect(net.url).toBe("wss://up.example");

  relay.onclose();
  await vi.advanceTimersByTimeAsync(3000);
  expect(tried).toEqual([
    "wss://down.example",
    "wss://up.example",
    "wss://down.example",
    "wss://up.example",
  ]);
  net.close();
  vi.useRealTimers();
});

test("a relay's CLOSED reaches the subscriber, and closing it ourselves doesn't", async () => {
  const handlers: { onclose(reason: string): void }[] = [];
  const relay = {
    subscribe: (_: unknown, params: { onclose(reason: string): void }) => {
      handlers.push(params);
      return { close: () => params.onclose("closed by caller") };
    },
    close: vi.fn(),
  };
  vi.spyOn(Relay, "connect").mockResolvedValue(relay as unknown as Relay);
  const net = new Net("wss://up.example", keySigner(generateSecretKey()));
  await vi.waitFor(() => expect(net.online).toBe(true));
  const refused: string[] = [];
  const stop = net.subscribe(
    [{}],
    () => {},
    undefined,
    (reason) => refused.push(reason),
  );
  handlers[0].onclose("error: too many subscriptions");
  stop();
  handlers[0].onclose("relay connection closed");
  expect(refused).toEqual(["error: too many subscriptions"]);
  net.close();
});

const INFO = {
  limitation: {
    created_at_lower_limit: 2,
    created_at_upper_limit: 5,
    created_at_window_kinds: [1641, 1642],
  },
};

test("a relay checks clocks when NIP-11 advertises a past bound of seconds on the move kinds", () => {
  const window = timeWindowOf(INFO);
  expect(window).toEqual({ past: 2, future: 5, kinds: [1641, 1642] });
  expect(timed(window, 1641)).toBe(true);
  expect(timed(window, 1)).toBe(false);
  expect(timed(timeWindowOf({ limitation: { created_at_lower_limit: 2 } }), 1641)).toBe(true);
  expect(timed(timeWindowOf({ limitation: { created_at_lower_limit: 94_608_000 } }), 1641)).toBe(
    false,
  );
  expect(timeWindowOf({ limitation: {} })).toBeNull();
  expect(timeWindowOf("<html>")).toBeNull();
});

test("an event is stale when its kind is covered and it is older than the past bound", () => {
  const window = timeWindowOf(INFO);
  expect(stale(window, { kind: 1641, created_at: 97 }, 100)).toBe(true);
  expect(stale(window, { kind: 1641, created_at: 98 }, 100)).toBe(false);
  expect(stale(window, { kind: 1640, created_at: 0 }, 100)).toBe(false);
  expect(stale(null, { kind: 1641, created_at: 0 }, 100)).toBe(false);
});

test("deliver signs again with a fresh time only when the relay's window refused the event", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(INFO)));
  const published: { id: string; created_at: number; content: string }[] = [];
  const relay = {
    subscribe: vi.fn(),
    close: vi.fn(),
    publish: async (event: { id: string; created_at: number; content: string }) => {
      published.push(event);
      if (published.length === 1) throw new Error("invalid: created_at outside the window");
      if (published.length === 3) throw new Error("rate-limited: slow down");
      return "";
    },
  };
  vi.spyOn(Relay, "connect").mockResolvedValue(relay as unknown as Relay);
  const signer = keySigner(generateSecretKey());
  const net = new Net("wss://up.example", signer);
  await vi.waitFor(() => expect(net.window).not.toBeNull());
  const now = Math.floor(Date.now() / 1000);
  const move = { kind: 1641, created_at: now - 60, tags: [], content: "e4" };
  const sent = await deliver(net, move, signer, 0);
  expect(published.map((event) => event.content)).toEqual(["e4", "e4"]);
  expect(published[1].created_at).toBeGreaterThanOrEqual(now);
  expect(sent?.id).toBe(published[1].id);

  const fresh = await deliver(net, { ...move, created_at: now + 1, content: "d4" }, signer, 0);
  expect(await deliver({ send: async (event) => event }, move, signer)).toMatchObject({
    created_at: move.created_at,
  });
  expect(published.slice(2).map((event) => event.id)).toEqual([fresh!.id, fresh!.id]);
  net.close();
  vi.unstubAllGlobals();
});
