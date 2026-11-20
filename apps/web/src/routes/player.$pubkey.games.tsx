import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";
import { must, PUBKEY } from "../app/params.ts";

export const Route = createFileRoute("/player/$pubkey/games")({
  params: { parse: ({ pubkey }) => ({ pubkey: must(pubkey, PUBKEY) }) },
  loader: ({ params }) => open({ name: "list", kind: "player", pubkey: params.pubkey }),
  component: Page,
});
