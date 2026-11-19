import { expect, test } from "vitest";
import { platformFrom } from "./platform.ts";

const KEY = "1".repeat(64);

test("the platform takes 15% unless VITE_PLATFORM_SHARE says otherwise", () => {
  const env = { VITE_PLATFORM_PUBKEY: KEY, VITE_PLATFORM_LUD16: "nochess@example.com" };
  expect(platformFrom(env)).toEqual({ pubkey: KEY, lud16: "nochess@example.com", share: 15 });
  expect(platformFrom({ ...env, VITE_PLATFORM_SHARE: "" })?.share).toBe(15);
  expect(platformFrom({ ...env, VITE_PLATFORM_SHARE: "7.5" })?.share).toBe(7.5);
  expect(platformFrom({ ...env, VITE_PLATFORM_SHARE: "0" })?.share).toBe(0);
  expect(platformFrom({ ...env, VITE_PLATFORM_SHARE: "80" })?.share).toBe(15);
  expect(platformFrom({ ...env, VITE_PLATFORM_SHARE: "lots" })?.share).toBe(15);
});

test("without both a key and a lightning address there is no platform share", () => {
  expect(platformFrom({})).toBeNull();
  expect(platformFrom({ VITE_PLATFORM_PUBKEY: KEY, VITE_PLATFORM_LUD16: "" })).toBeNull();
  expect(platformFrom({ VITE_PLATFORM_LUD16: "a@b.c", VITE_PLATFORM_SHARE: "10" })).toBeNull();
});
