import { describe, expect, it } from "vitest";
import {
  audible,
  DEFAULTS,
  loadSettings,
  mute,
  saveSettings,
  type Settings,
  toggleAudio,
} from "./settings.ts";

const memory = (items: Record<string, string> = {}) => {
  const data = new Map(Object.entries(items));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("settings", () => {
  it("are the defaults when nothing is stored: sounds on, music and chat off where the brief says", () => {
    expect(loadSettings(memory())).toEqual(DEFAULTS);
    expect(DEFAULTS).toMatchObject({
      board: "altitude",
      pieces: "chessnut",
      sound: true,
      music: false,
      chat: true,
      muted: [],
    });
  });

  it("survive a save and a load", () => {
    const store = memory();
    const changed: Settings = { ...DEFAULTS, board: "dusk", pieces: "celtic", volume: 0.3 };
    saveSettings(store, changed);
    expect(loadSettings(store)).toEqual(changed);
  });

  it("keep what is valid from a stored value and default the rest", () => {
    const store = memory({
      "luft:settings": JSON.stringify({
        board: "plaid",
        pieces: "celtic",
        volume: 7,
        sound: "yes",
      }),
    });
    expect(loadSettings(store)).toEqual({ ...DEFAULTS, pieces: "celtic", volume: 1 });
  });

  it("cap what a bot without a record may charge, at whole sats of zero or more", () => {
    expect(DEFAULTS.newBotCap).toBe(100);
    const stored = (newBotCap: unknown) =>
      loadSettings(memory({ "luft:settings": JSON.stringify({ newBotCap }) })).newBotCap;
    expect(stored(500)).toBe(500);
    expect(stored(0)).toBe(0);
    expect(stored(12.7)).toBe(12);
    expect(stored(-3)).toBe(100);
    expect(stored("lots")).toBe(100);
  });

  it("fall back to the defaults when the stored value isn't JSON", () => {
    expect(loadSettings(memory({ "luft:settings": "{oops" }))).toEqual(DEFAULTS);
  });

  it("take the theme the app stored before settings existed", () => {
    expect(loadSettings(memory({ "luft:theme": "dark" })).theme).toBe("dark");
  });

  it("mute and unmute a key without duplicates, and drop keys that aren't hex", () => {
    const key = "a".repeat(64);
    const once = mute(DEFAULTS, key, true);
    expect(mute(once, key, true).muted).toEqual([key]);
    expect(mute(once, key, false).muted).toEqual([]);
    const store = memory({ "luft:settings": JSON.stringify({ muted: [key, "nope", key] }) });
    expect(loadSettings(store).muted).toEqual([key]);
  });

  it("turn sounds and music off together, and back on with the music as it was", () => {
    const playing = { ...DEFAULTS, music: true };
    const off = toggleAudio(playing);
    expect(off).toMatchObject({ sound: false, music: false });
    expect(audible(off)).toBe(false);
    expect(toggleAudio(off)).toMatchObject({ sound: true, music: true });
    const store = memory();
    saveSettings(store, off);
    expect(toggleAudio(loadSettings(store))).toMatchObject({ sound: true, music: true });
    expect(toggleAudio(toggleAudio(DEFAULTS))).toMatchObject({ sound: true, music: false });
  });

  it("count as audible while either sounds or music is on", () => {
    const musicOnly = { ...DEFAULTS, sound: false, music: true };
    expect(audible(musicOnly)).toBe(true);
    expect(toggleAudio(musicOnly)).toMatchObject({ sound: false, music: false });
  });
});
