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
