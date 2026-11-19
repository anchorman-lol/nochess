import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { Shell } from "../components/shell.tsx";
import { ZapSheet } from "../components/zap-sheet.tsx";
import { ComputerPage } from "../pages/computer.tsx";
import { GamePage } from "../pages/game.tsx";
import { Landing } from "../pages/landing.tsx";
import { Lobby } from "../pages/lobby.tsx";
import { ProfilePage } from "../pages/profile.tsx";
import { SettingsPage } from "../pages/settings.tsx";
import { board, getVersion, route, subscribe } from "./store.ts";

const KEYS: Record<string, string> = {
  ArrowLeft: "prev",
  ArrowRight: "next",
  ArrowUp: "first",
  Home: "first",
  ArrowDown: "last",
  End: "last",
};

export function App() {
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [role=slider]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey || !route?.play) return;
      const to = KEYS[event.key];
      if (to) board.nav(to);
      else if (event.key === "f") board.flip();
      else if (event.key === "Escape") board.escape();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <Shell>
          <Page />
        </Shell>
        <ZapSheet />
      </MotionConfig>
    </LazyMotion>
  );
}

function Page() {
  switch (route?.name) {
    case "landing":
      return <Landing model={route.view()} />;
    case "lobby":
      return <Lobby model={route.view()} />;
    case "game":
      return <GamePage model={route.view()} />;
    case "profile":
      return <ProfilePage model={route.view()} />;
    case "computer":
      return <ComputerPage model={route.view()} />;
    case "settings":
      return <SettingsPage />;
    default:
      return null;
  }
}
