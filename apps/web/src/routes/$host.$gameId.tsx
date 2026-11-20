import { createFileRoute } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";
import { must, PUBKEY } from "../app/params.ts";

export const Route = createFileRoute("/$host/$gameId")({
  params: {
    parse: ({ host, gameId }) => ({
      host: must(host, PUBKEY),
      gameId: must(gameId, /^[0-9a-z-]{1,64}$/),
    }),
  },
  loader: ({ params }) => open({ name: "game", ...params }),
  component: Page,
});
