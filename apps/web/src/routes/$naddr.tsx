import { createFileRoute, notFound } from "@tanstack/react-router";
import { open, Page } from "../app/open.ts";
import { parseGameLink } from "../nostr/browser.ts";

/** A shared game link: the game and the relay it is on, as a NIP-19 naddr. */
export const Route = createFileRoute("/$naddr")({
  params: {
    parse: ({ naddr }) => {
      const game = parseGameLink(naddr);
      if (!game.host) throw notFound();
      return { naddr, ...game };
    },
  },
  loader: ({ params: { host, gameId, relay } }) => open({ name: "game", host, gameId, relay }),
  component: Page,
});
