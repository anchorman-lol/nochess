import { describe, expect, it } from "vitest";
import { editRelays, relaysFrom } from "./relays.ts";

const memory = (items: Record<string, string> = {}) => ({
  getItem: (key: string) => items[key] ?? null,
});
const DEFAULTS = ["wss://relay.anchorman.lol", "wss://nos.lol", "wss://relay.damus.io"];

describe("the relay list", () => {
  it("is the defaults until the player saves one", () => {
    expect(relaysFrom(memory(), memory(), DEFAULTS)).toEqual(DEFAULTS);
  });

  it("is the saved list, and a share link's relay wins for its tab", () => {
    const local = memory({
      "nochess:relays": JSON.stringify(["wss://a.example", "wss://b.example"]),
    });
    expect(relaysFrom(memory(), local, DEFAULTS)).toEqual(["wss://a.example", "wss://b.example"]);
    const session = memory({ "nochess:relay": "wss://shared.example" });
    expect(relaysFrom(session, local, DEFAULTS)).toEqual(["wss://shared.example"]);
  });

  it("takes the single relay an older version saved, and ignores a list that isn't one", () => {
    expect(
      relaysFrom(memory(), memory({ "nochess:relay": "wss://old.example" }), DEFAULTS),
    ).toEqual(["wss://old.example"]);
    const broken = memory({ "nochess:relays": "{oops" });
    expect(relaysFrom(memory(), broken, DEFAULTS)).toEqual(DEFAULTS);
    expect(relaysFrom(memory(), memory({ "nochess:relays": "[]" }), DEFAULTS)).toEqual(DEFAULTS);
  });

  it("adds a websocket URL once, at the end, tidied", () => {
    expect(editRelays(DEFAULTS, "add", " wss://new.example/ ")).toEqual([
      ...DEFAULTS,
      "wss://new.example",
    ]);
    expect(editRelays(DEFAULTS, "add", "wss://nos.lol/")).toEqual(DEFAULTS);
  });

  it("refuses what isn't a websocket URL", () => {
    expect(editRelays(DEFAULTS, "add", "https://nos.lol")).toBeNull();
    expect(editRelays(DEFAULTS, "add", "nos.lol")).toBeNull();
    expect(editRelays(DEFAULTS, "add", "wss://")).toBeNull();
  });

  it("moves a relay up, or to the top to use it first", () => {
    expect(editRelays(DEFAULTS, "up", "wss://relay.damus.io")).toEqual([
      "wss://relay.anchorman.lol",
      "wss://relay.damus.io",
      "wss://nos.lol",
    ]);
    expect(editRelays(DEFAULTS, "up", "wss://relay.anchorman.lol")).toEqual(DEFAULTS);
    expect(editRelays(DEFAULTS, "use", "wss://relay.damus.io")).toEqual([
      "wss://relay.damus.io",
      "wss://relay.anchorman.lol",
      "wss://nos.lol",
    ]);
  });

  it("removes a relay but never the last one", () => {
    expect(editRelays(DEFAULTS, "remove", "wss://nos.lol")).toEqual([
      "wss://relay.anchorman.lol",
      "wss://relay.damus.io",
    ]);
    expect(editRelays(["wss://only.example"], "remove", "wss://only.example")).toBeNull();
  });
});
