import { expect, test } from "vitest";
import { migrateKeys } from "./migrate.ts";

const memory = (items: Record<string, string>) => {
  const data = new Map(Object.entries(items));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

test("keys stored under the old prefix are copied once to nochess:, the secret key above all", () => {
  const store = memory({
    "luft:key": "secret",
    "luft:relays": '["ws://a"]',
    "luft:settings": "{}",
    "nochess:relays": '["ws://new"]',
    other: "x",
  });
  migrateKeys(store);
  expect(store.data.get("nochess:key")).toBe("secret");
  expect(store.data.get("nochess:settings")).toBe("{}");
  expect(store.data.get("nochess:relays")).toBe('["ws://new"]');
  expect(store.data.get("luft:key")).toBe("secret");
  expect(store.data.has("nochess:other")).toBe(false);
});
