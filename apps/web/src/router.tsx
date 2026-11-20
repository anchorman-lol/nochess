import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  const base = import.meta.env.BASE_URL;
  /** Links from before real URLs, `#/play` or `#/<naddr>`, open the same page at its path. */
  if (typeof window !== "undefined" && location.hash.startsWith("#/"))
    history.replaceState(null, "", base + location.hash.slice(2));
  return createRouter({ routeTree, basepath: base, scrollRestoration: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
