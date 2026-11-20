import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";
import { must, PUBKEY } from "../app/params.ts";

export const Route = createFileRoute("/player/$pubkey/")({
  params: { parse: ({ pubkey }) => ({ pubkey: must(pubkey, PUBKEY) }) },
  loader: ({ params }) => open({ name: "profile", pubkey: params.pubkey }),
  component: Page,
});
