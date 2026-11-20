import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

export const Route = createFileRoute("/about")({
  loader: ({ location }) => open({ name: "landing" }, location.hash),
  component: Page,
});
