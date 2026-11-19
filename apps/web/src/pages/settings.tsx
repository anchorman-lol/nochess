import { Slider } from "@luft/ui/components/slider";
import { Switch } from "@luft/ui/components/switch";
import { cn } from "cn";
import { payUrl } from "@luft/core/zap/lnurl.ts";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ownProfile, saveProfile, setSettings, settings, sound } from "../app/store.ts";
import { Board, pieceUrl } from "../components/board.tsx";
import { Hint, Player } from "../components/common.tsx";
import { btn, btnPrimary, field } from "../components/table.tsx";
import { BOARDS, mute, PIECES, type Settings, THEMES } from "../lib/settings.ts";
import type { ProfileEdits } from "../nostr/profile.ts";

const PREVIEW = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const BOARD_NAMES: Record<Settings["board"], [string, string]> = {
  altitude: ["Altitude", "Air blue. The default."],
  diagram: ["Diagram", "Hatched like a printed book."],
  dusk: ["Dusk", "Muted plum, warm without brown."],
  glacier: ["Glacier", "The board this app started with."],
};
const PIECE_NAMES: Record<Settings["pieces"], [string, string]> = {
  chessnut: ["Chessnut", "Flat and crisp. Alexis Luengas, Apache 2.0."],
  celtic: ["Celtic", "Soft shading. Maurizio Monge, MIT."],
};
const SOUNDS = {
  move: "Move",
  capture: "Capture",
  castle: "Castle",
  check: "Check",
  low: "Low time",
  end: "Game end",
};
const set = (change: Partial<Settings>) => setSettings({ ...settings, ...change });

export function SettingsPage() {
  const theme = document.documentElement.dataset.theme;
  return (
    <main
      className="mx-auto grid max-w-3xl gap-10 px-3 pt-6 pb-20 md:px-5"
      data-testid="settings-page"
    >
      <h1 className="text-[1.6rem] leading-tight font-extrabold tracking-[-0.02em]">Settings</h1>
      <ProfileEditor />
      <Group title="Theme" hint="System follows your device.">
        <div
          className="inline-flex justify-self-start rounded-[0.6rem] bg-sunk p-0.5"
          role="radiogroup"
          aria-label="Theme"
        >
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={settings.theme === option}
              data-testid={`settings-theme-${option}`}
              onClick={() => set({ theme: option })}
              className="h-8 rounded-[0.45rem] px-4 text-[0.9rem] font-semibold text-muted-foreground capitalize aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm"
            >
              {option}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Board">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label="Board">
          {BOARDS.map((name) => (
            <Choice
              key={name}
              on={settings.board === name}
              testid={`settings-board-${name}`}
              onClick={() => set({ board: name })}
              title={BOARD_NAMES[name][0]}
              note={BOARD_NAMES[name][1]}
            >
              <div data-board={name} data-theme={theme} data-pieces={settings.pieces}>
                <Board
                  mini
                  interactive={false}
                  model={{
                    fen: PREVIEW,
                    flipped: false,
                    selected: null,
                    targets: [],
                    last: ["d1", "h5"],
                    check: null,
                    premove: [],
                    promotion: null,
                    dragging: null,
                    ply: 0,
                    dropped: true,
                  }}
                />
              </div>
            </Choice>
          ))}
        </div>
      </Group>
      <Group title="Pieces">
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Pieces">
          {PIECES.map((name) => (
            <Choice
              key={name}
              on={settings.pieces === name}
              testid={`settings-pieces-${name}`}
              onClick={() => set({ pieces: name })}
              title={PIECE_NAMES[name][0]}
              note={PIECE_NAMES[name][1]}
            >
              <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] justify-items-center gap-1 rounded-md bg-[var(--sq-light)] p-2">
                {["wK", "wQ", "wN", "bB", "bR", "bP"].map((code) => (
                  <img
                    key={code}
                    alt=""
                    src={pieceUrl(code, name)}
                    className="aspect-square w-full max-w-12"
                  />
                ))}
              </div>
            </Choice>
          ))}
        </div>
      </Group>
      <Group
        title="Sound"
        hint="Moves, captures, checks, castling, the last ten seconds and the end of a game. Off means nothing plays."
      >
        <Row label="Game sounds">
          <Switch
            checked={settings.sound}
            onCheckedChange={(on) => set({ sound: on })}
            data-testid="settings-sound"
            aria-label="Game sounds"
          />
        </Row>
        <Row label="Volume">
          <Slider
            className="data-horizontal:w-48"
            value={[Math.round(settings.volume * 100)]}
            min={0}
            max={100}
            disabled={!settings.sound}
            aria-label="Volume"
            onValueChange={(value) =>
              set({ volume: (Array.isArray(value) ? value[0] : value) / 100 })
            }
            onValueCommitted={() => sound("move")}
          />
        </Row>
        <div className="flex flex-wrap gap-2">
          {Object.entries(SOUNDS).map(([name, label]) => (
            <button
              key={name}
              type="button"
              className={cn(btn, "h-8 text-[0.87rem]")}
              disabled={!settings.sound}
              onClick={() => sound(name as keyof typeof SOUNDS)}
            >
              {label}
            </button>
          ))}
        </div>
      </Group>
      <Group
        title="Music"
        hint="Slow ambient chords while you play, made in your browser. Off unless you turn it on."
      >
        <Row label="Ambient music">
          <Switch
            checked={settings.music}
            onCheckedChange={(on) => set({ music: on })}
            data-testid="settings-music"
            aria-label="Ambient music"
          />
        </Row>
        <Row label="Music volume">
          <Slider
            className="data-horizontal:w-48"
            value={[Math.round(settings.musicVolume * 100)]}
            min={0}
            max={100}
            disabled={!settings.music}
            aria-label="Music volume"
            onValueChange={(value) =>
              set({ musicVolume: (Array.isArray(value) ? value[0] : value) / 100 })
            }
          />
        </Row>
      </Group>
      <Group title="Chat" hint="Off hides every game's chat in this browser.">
        <Row label="Game chat">
          <Switch
            checked={settings.chat}
            onCheckedChange={(on) => set({ chat: on })}
            data-testid="settings-chat"
            aria-label="Game chat"
          />
        </Row>
        {settings.muted.length > 0 && (
          <ul className="grid gap-1 border-t border-line pt-2" aria-label="Muted players">
            {settings.muted.map((pubkey) => (
              <li key={pubkey} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  <Player pubkey={pubkey} />
                </span>
                <button
                  type="button"
                  className={cn(btn, "h-8 text-[0.87rem]")}
                  onClick={() => setSettings(mute(settings, pubkey, false))}
                >
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group
        title="Bots"
        hint="A bot that has never answered a challenge or played a game can't charge you more than this. It shows its price and record in the lobby either way."
      >
        <Row label="Most a new bot may charge (sats)">
          <input
            type="number"
            min={0}
            step={1}
            defaultValue={settings.newBotCap}
            data-testid="settings-bot-cap"
            aria-label="Most a new bot may charge, in sats"
            className={cn(field, "w-28 text-right tabular-nums")}
            onChange={(event) => {
              const sats = event.target.valueAsNumber;
              if (sats >= 0) set({ newBotCap: Math.floor(sats) });
            }}
          />
        </Row>
      </Group>
      <Hint>These settings live in this browser only.</Hint>
    </main>
  );
}

const FIELDS: [keyof ProfileEdits, string, string, string?][] = [
  ["name", "Name", "alekhine", "A short handle, no spaces."],
  ["display_name", "Display name", "Alexander Alekhine", "The full name shown on your card."],
  ["picture", "Picture URL", "https://…/me.png"],
  ["lud16", "Lightning address", "you@wallet.example"],
  ["about", "About", "A line or two about you"],
];

/** Edits my kind 0: the fields shown change, every other field of it stays as it was. */
function ProfileEditor() {
  const [values, setValues] = useState<ProfileEdits | null>(null);
  const [state, setState] = useState("");
  useEffect(() => {
    void ownProfile().then(
      (event) => setValues(profileFields(event?.content)),
      () => setValues({}),
    );
  }, []);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const edits = Object.fromEntries(new FormData(event.currentTarget)) as ProfileEdits;
    if (edits.lud16?.trim() && !payUrl({ lud16: edits.lud16.trim(), lud06: "" }))
      return setState("That isn't a lightning address: it looks like name@wallet.example.");
    setState("Publishing…");
    saveProfile(edits).then(
      () => setState("Published."),
      (reason) =>
        setState(`The relay didn't take it: ${reason instanceof Error ? reason.message : reason}`),
    );
  };
  return (
    <Group
      title="Profile"
      id="profile"
      hint="Your Nostr profile, signed with your key. Other Nostr apps show it too, and fields this app doesn't edit are kept."
    >
      {values ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={save} data-testid="profile-editor">
          {FIELDS.map(([name, label, placeholder, hint]) => (
            <div key={name} className={cn("grid gap-1", name === "about" && "sm:col-span-2")}>
              <label className="grid gap-1 text-[0.87rem] font-semibold">
                {label}
                {name === "about" ? (
                  <textarea
                    name={name}
                    defaultValue={values[name]}
                    placeholder={placeholder}
                    rows={3}
                    className={cn(field, "h-auto py-2 font-normal")}
                  />
                ) : (
                  <input
                    name={name}
                    defaultValue={values[name]}
                    placeholder={placeholder}
                    aria-describedby={hint && `hint-${name}`}
                    className={cn(field, "font-normal")}
                  />
                )}
              </label>
              {hint && (
                <small id={`hint-${name}`} className="text-[0.8rem] text-muted-foreground">
                  {hint}
                </small>
              )}
            </div>
          ))}
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className={cn(btn, btnPrimary)} data-testid="profile-save">
              Publish profile
            </button>
            <span className="text-[0.9rem] text-muted-foreground" role="status">
              {state}
            </span>
          </div>
        </form>
      ) : (
        <Hint>Loading your profile…</Hint>
      )}
    </Group>
  );
}

const profileFields = (content = "{}"): ProfileEdits => {
  try {
    const raw: Record<string, unknown> = JSON.parse(content) ?? {};
    return Object.fromEntries(
      FIELDS.map(([name]) => [name, typeof raw[name] === "string" ? raw[name] : ""]),
    );
  } catch {
    return {};
  }
};

function Group({
  title,
  hint,
  id,
  children,
}: {
  title: string;
  hint?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid scroll-mt-16 gap-3 border-t border-line pt-5">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <Hint className="max-w-[60ch]">{hint}</Hint>}
      </div>
      {children}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-h-10 items-center justify-between gap-4">
    <span className="font-semibold">{label}</span>
    {children}
  </div>
);

function Choice({
  on,
  onClick,
  title,
  note,
  children,
  testid,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  note: string;
  children: ReactNode;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-testid={testid}
      onClick={onClick}
      className="grid content-start gap-2 rounded-xl border border-line p-2.5 text-left transition-colors duration-150 hover:border-muted-foreground aria-checked:border-brand aria-checked:bg-brand-soft aria-checked:shadow-[0_0_0_1px_var(--brand)]"
    >
      {children}
      <span>
        <b className="block font-bold">{title}</b>
        <span className="text-[0.85rem] text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}
