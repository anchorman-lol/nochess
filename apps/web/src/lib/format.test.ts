import { expect, test } from "vitest";
import { botStatus, price, unavailable } from "./format.ts";

test("a bot's price reads Free at 0 and in sats otherwise", () => {
  expect(price(0)).toBe("Free");
  expect(price(1)).toBe("1 sat");
  expect(price(21)).toBe("21 sats");
});

test("a free bot with every table taken is unavailable, as is one offline", () => {
  const full = { online: true, free: 0, max: 5 };
  expect(botStatus(full)).toBe("online, every table busy");
  expect(unavailable(full)).toBe("Every table of this bot is busy.");
  expect(unavailable({ online: false, free: 0, max: 5 })).toBe("This bot is offline.");
  expect(botStatus({ online: true, free: 2, max: 5 })).toBe("online, 2 of 5 free");
  expect(unavailable({ online: true, free: 2, max: 5 })).toBeUndefined();
});
