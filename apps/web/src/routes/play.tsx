import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/play")({
  loader: ({ location }) => open({ name: "lobby" }, location.hash),
  component: Page,
});
