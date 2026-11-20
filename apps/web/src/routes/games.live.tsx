import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/games/live")({
  loader: () => open({ name: "list", kind: "live" }),
  component: Page,
});
