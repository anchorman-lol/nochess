import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";
import { must } from "../app/params.ts";

export const Route = createFileRoute("/computer/$level")({
  params: { parse: ({ level }) => ({ level: Number(must(level, /^[1-8]$/)) }) },
  loader: ({ params }) => open({ name: "computer", level: params.level }),
  component: Page,
});
