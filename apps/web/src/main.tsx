import "./lib/run-migration.ts";
import "./app.css";
import { BRAND } from "@nochess/ui/brand";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app.tsx";
import { applySettings, navigate, setSettings, settings } from "./app/store.ts";

document.title = `${BRAND.name}: ${BRAND.tagline.replace(/\.$/, "")}`;
applySettings();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySettings);
if (settings.music)
  window.addEventListener("pointerdown", () => setSettings(settings), { once: true });
window.addEventListener("hashchange", navigate);
navigate();
createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
