import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/leaderboard")({
  loader: () => open({ name: "list", kind: "leaderboard" }),
  component: Page,
});
