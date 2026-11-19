import { Icon } from "@luft/ui/components/icon";
import { Wordmark } from "@luft/ui/components/logo";
import { cn } from "cn";
import type { ReactNode } from "react";
import { route, setSettings, settings, status } from "../app/store.ts";

const NAV = [
  { href: "#/play", label: "Play", name: "lobby", testid: "home" },
  { href: "#/about", label: "About", name: "landing" },
] as const;

/** The top bar: wordmark, Play and About, the relay, sound and theme. Then the page. */
export function Shell({ children }: { children: ReactNode }) {
  const { online, relay } = status();
  const dark = document.documentElement.dataset.theme === "dark";
  const next = dark ? "light" : "dark";
  return (
    <>
      <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-line bg-background/95 px-3 backdrop-blur-sm sm:gap-4 md:gap-7 md:px-5">
        <a href="#/" className="text-[1.15rem] text-foreground sm:text-[1.3rem]" aria-label="Home">
          <Wordmark />
        </a>
        <nav className="flex h-full sm:gap-1" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-testid={"testid" in item ? item.testid : undefined}
              aria-current={route?.name === item.name ? "page" : undefined}
              className="flex items-center px-2 font-medium sm:px-2.5 text-muted-foreground shadow-[inset_0_-2px_0_transparent] transition-colors duration-150 hover:text-foreground aria-[current]:text-foreground aria-[current]:shadow-[inset_0_-2px_0_var(--brand)]"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center sm:gap-1">
          <span
            data-testid="relay-status"
            title={`Moves travel through ${relay}`}
            className="mr-1.5 flex items-center gap-2 text-[0.87rem] sm:mr-2 text-muted-foreground"
          >
            <i
              className={cn(
                "size-2 rounded-full",
                online ? "bg-good" : "animate-pulse bg-muted-foreground",
              )}
            />
            <span className="max-sm:sr-only">{online ? "relay connected" : "connecting…"}</span>
          </span>
          <IconButton
            label={settings.sound ? "Turn sounds off" : "Turn sounds on"}
            testid="sound"
            onClick={() => setSettings({ ...settings, sound: !settings.sound })}
          >
            <Icon name={settings.sound ? "sound" : "muted"} />
          </IconButton>
          <IconButton
            label={`Switch to ${next} theme`}
            testid="theme"
            onClick={() => setSettings({ ...settings, theme: next })}
          >
            <Icon name={dark ? "sun" : "moon"} />
          </IconButton>
          <a
            href="#/settings"
            aria-label="Settings"
            title="Settings"
            data-testid="settings"
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-sunk hover:text-foreground"
          >
            <Icon name="gear" />
          </a>
        </div>
      </header>
      {children}
    </>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  testid,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  testid?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-sunk hover:text-foreground disabled:opacity-35"
    >
      {children}
    </button>
  );
}
