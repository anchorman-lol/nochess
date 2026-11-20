import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/games/")({
  loader: () => open({ name: "list", kind: "games" }),
  component: Page,
});
