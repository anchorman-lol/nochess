import { lazyRouteComponent } from "@tanstack/react-router";
import type { Page as Spec } from "./store.ts";

/**
 * What every route needs, loaded only in the browser: the store reads localStorage as it loads,
 * and the build renders the HTML shell on the server.
 */
export const Page = lazyRouteComponent(() => import("./app.tsx"), "Page");
export async function open(page: Spec, anchor?: string) {
  const [{ enter }] = await Promise.all([import("./store.ts"), Page.preload?.()]);
  enter(page, anchor);
}
