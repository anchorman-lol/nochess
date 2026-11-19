import { generateSecretKey } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { expect, test, vi } from "vitest";
import { keySigner, Net } from "./net.ts";

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
