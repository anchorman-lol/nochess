import { type Browser, expect, type Page } from "@playwright/test";

export const RELAY = "ws://127.0.0.1:7788";

/** A browser of its own, so a key of its own. `tc` presets a time control the menu doesn't offer. */
export async function player(browser: Browser, tc?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  if (tc) await context.addInitScript((value) => localStorage.setItem("luft:tc", value), tc);
  return context.newPage();
}

/** The host opens a seek, the guest finds it on the home page and joins. Returns [White, Black]. */
export async function sitDown(host: Page, guest: Page, rated = true): Promise<[Page, Page]> {
  await host.goto("/");
  await expect(host.getByTestId("relay-status")).toHaveText("relay connected");
  await host.getByTestId("rated").setChecked(rated);
  await host.getByTestId("create").click();
  await expect(host.getByTestId("waiting")).toBeVisible();
  await guest.goto("/");
  await guest.locator(`a[href="${new URL(host.url()).hash}"]`).click();
  await guest.getByTestId("join").click();
  for (const page of [host, guest]) await expect(page.getByTestId("table")).toBeVisible();
  const hostSeat = await host.getByTestId("table").getAttribute("data-seat");
  return hostSeat === "0" ? [host, guest] : [guest, host];
}

/** Plays a move by clicking its two squares and waits until both boards show it. */
export async function move(mover: Page, from: string, to: string, watchers: Page[] = []) {
  const before = await mover.getByTestId("board").getAttribute("data-fen");
  await mover.getByTestId(`sq-${from}`).click();
  await expect(mover.getByTestId(`sq-${to}`)).toHaveClass(/target/);
  await mover.getByTestId(`sq-${to}`).click();
  for (const page of [mover, ...watchers])
    await expect(page.getByTestId("board")).not.toHaveAttribute("data-fen", before!);
}
