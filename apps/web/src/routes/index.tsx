import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";

/** The landing page until the first visit to the lobby, then the lobby. */
export const Route = createFileRoute("/")({
  loader: ({ location }) => open({ name: "home" }, location.hash),
  component: Page,
});
