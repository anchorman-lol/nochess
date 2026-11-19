import { type ChildProcess, spawn } from "node:child_process";
import { type Browser, expect, type Page } from "@playwright/test";
import type { Filter } from "nostr-tools/filter";
import type { NostrEvent } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";

export const RELAY = "ws://127.0.0.1:7788";
/** The mock Lightning provider, its key, and the key the platform's share is zapped to. */
export const ZAP_HOST = "127.0.0.1:7798";
export const ZAPMOCK_KEY = "2".repeat(64);
export const RATER_KEY = "8".repeat(64);
export const PLATFORM = "193e245d172bfe0b717e47c6008bfb8611d47356c89779b86daafe8b50655ec9";

/** Starts a bot or reviewer against the test relay and waits until it says `ready`. */
export async function service(args: string[], env: Record<string, string>, ready: string) {
  const child: ChildProcess = spawn("node", args, {
    env: { ...process.env, LUFT_RELAY: RELAY, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (chunk) => String(chunk).includes(ready) && resolve());
    child.on("exit", (code) => reject(new Error(`${args.join(" ")} exited with ${code}`)));
  });
  return child;
}

/** A browser of its own, so a key of its own. `tc` presets a time control the menu doesn't offer. */
export async function player(
  browser: Browser,
  tc?: string,
  store: Record<string, string> = {},
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.addInitScript(
    (items) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    },
    { ...(tc && { "luft:tc": tc }), ...store },
  );
  return context.newPage();
}

/** Publishes a lightning address at the mock provider for this browser's key; returns the key. */
export async function receiveZaps(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.locator("details.wallet summary").click();
  await page.getByTestId("lud16").fill(`${name}@${ZAP_HOST}`);
  await page.getByTestId("lud16").press("Enter");
  const href = await page.locator('.you a[href^="#/player/"]').getAttribute("href");
  return href!.split("/")[2];
}

/** Sets the amount and the platform's share in an open zap sheet and pays; the lines end up `paid`. */
export async function zap(page: Page, sats: number, percent: number, lines: string[]) {
  const sheet = page.getByTestId("zap-sheet");
  await sheet.getByTestId("zap-sats").fill(String(sats));
  await sheet.getByTestId("zap-sats").press("Tab");
  await sheet.getByTestId("zap-percent").fill(String(percent));
  await sheet.getByTestId("zap-percent").press("Tab");
  await expect(sheet.getByTestId("zap-line").locator("b")).toHaveText(lines);
  await sheet.getByTestId("zap-go").click();
}
export const paid = async (page: Page, count: number) =>
  expect(page.locator('[data-testid="zap-line"][data-state="paid"]')).toHaveCount(count);

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

/** What the test relay has stored for a filter. */
export async function stored(filter: Filter): Promise<NostrEvent[]> {
  const relay = await Relay.connect(RELAY);
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    const sub = relay.subscribe([filter], {
      onevent: (event) => events.push(event),
      oneose: () => {
        sub.close();
        relay.close();
        resolve(events);
      },
    });
  });
}
