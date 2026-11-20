import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/games/open")({
  loader: () => open({ name: "list", kind: "open" }),
  component: Page,
});
