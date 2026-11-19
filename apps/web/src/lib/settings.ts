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
  /** Whether the music was on when the header button silenced everything. */
  musicWas: boolean;
  chat: boolean;
  /** Keys whose chat lines this browser hides. */
  muted: string[];
  /** The most a bot without a record may charge for a game here, in sats. */
  newBotCap: number;
};
type Store = Pick<Storage, "getItem" | "setItem">;

const KEY = "nochess:settings";
export const DEFAULTS: Settings = {
  theme: "system",
  board: "altitude",
  pieces: "chessnut",
  sound: true,
  volume: 0.7,
  music: false,
  musicVolume: 0.4,
  musicWas: false,
  chat: true,
  muted: [],
  newBotCap: 100,
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
    theme: oneOf(THEMES, raw.theme ?? store.getItem("nochess:theme"), DEFAULTS.theme),
    board: oneOf(BOARDS, raw.board, DEFAULTS.board),
    pieces: oneOf(PIECES, raw.pieces, DEFAULTS.pieces),
    sound: flag(raw.sound, DEFAULTS.sound),
    volume: level(raw.volume, DEFAULTS.volume),
    music: flag(raw.music, DEFAULTS.music),
    musicVolume: level(raw.musicVolume, DEFAULTS.musicVolume),
    musicWas: flag(raw.musicWas, DEFAULTS.musicWas),
    chat: flag(raw.chat, DEFAULTS.chat),
    newBotCap:
      typeof raw.newBotCap === "number" && raw.newBotCap >= 0
        ? Math.floor(raw.newBotCap)
        : DEFAULTS.newBotCap,
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

export const audible = ({ sound, music }: Settings) => sound || music;

/** The header's one button: silences sounds and music, or brings both back as they were. */
export const toggleAudio = (settings: Settings): Settings =>
  audible(settings)
    ? { ...settings, sound: false, music: false, musicWas: settings.music }
    : { ...settings, sound: true, music: settings.musicWas };
