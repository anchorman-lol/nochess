import { expect, test } from "vitest";
import { build, readStatus } from "./events.ts";
import { sign } from "./testkit.ts";

const BOT = "a".repeat(64);

test("a bot's status says whether it is online and how many of its tables are free, until it expires", () => {
  const event = sign(BOT, build.status({ online: true, free: 3, max: 15, msat: 21_000 }, 1000));
  expect(event.kind).toBe(30315);
  expect(event.tags).toContainEqual(["d", "general"]);
  expect(event.tags).toContainEqual(["expiration", "1150"]);
  expect(readStatus(event, 1100)).toEqual({ online: true, free: 3, max: 15 });
  expect(readStatus(event, 1151)).toEqual({ online: false, free: 0, max: 15 });
  const off = sign(BOT, build.status({ online: false, free: 15, max: 15, msat: 0 }, 1000));
  expect(readStatus(off, 1001)).toEqual({ online: false, free: 15, max: 15 });
  expect(readStatus(undefined, 1001)).toEqual({ online: false, free: 0, max: 0 });
});
