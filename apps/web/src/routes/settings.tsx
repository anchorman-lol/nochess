import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/settings")({
  loader: ({ location }) => open({ name: "settings" }, location.hash),
  component: Page,
});
