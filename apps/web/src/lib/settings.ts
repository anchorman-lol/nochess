export const BOARDS = ["altitude", "diagram", "dusk", "glacier"] as const;
export const PIECES = ["chessnut", "celtic"] as const;
export const THEMES = ["system", "light", "dark"] as const;

export type Settings = {
  theme: (typeof THEMES)[number];
  board: (typeof BOARDS)[number];
  pieces: (typeof PIECES)[number];
  sound: boolean;
  /** 0 to 1, for the game sounds. */
  volume: number;
  music: boolean;
  musicVolume: number;
  chat: boolean;
  /** Keys whose chat lines this browser hides. */
  muted: string[];
};
type Store = Pick<Storage, "getItem" | "setItem">;

const KEY = "luft:settings";
export const DEFAULTS: Settings = {
  theme: "system",
  board: "altitude",
  pieces: "chessnut",
  sound: true,
  volume: 0.7,
  music: false,
  musicVolume: 0.4,
  chat: true,
  muted: [],
};

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const level = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

export function loadSettings(store: Store): Settings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(store.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // an unreadable value is replaced by the defaults
  }
  return {
    theme: oneOf(THEMES, raw.theme ?? store.getItem("luft:theme"), DEFAULTS.theme),
    board: oneOf(BOARDS, raw.board, DEFAULTS.board),
    pieces: oneOf(PIECES, raw.pieces, DEFAULTS.pieces),
    sound: flag(raw.sound, DEFAULTS.sound),
    volume: level(raw.volume, DEFAULTS.volume),
    music: flag(raw.music, DEFAULTS.music),
    musicVolume: level(raw.musicVolume, DEFAULTS.musicVolume),
    chat: flag(raw.chat, DEFAULTS.chat),
    muted: Array.isArray(raw.muted)
      ? [
          ...new Set(
            raw.muted.filter((key) => typeof key === "string" && /^[0-9a-f]{64}$/.test(key)),
          ),
        ]
      : [],
  };
}

export const saveSettings = (store: Store, settings: Settings) =>
  store.setItem(KEY, JSON.stringify(settings));

export const mute = (settings: Settings, pubkey: string, on: boolean): Settings => ({
  ...settings,
  muted: on
    ? [...new Set([...settings.muted, pubkey])]
    : settings.muted.filter((key) => key !== pubkey),
});
