import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { move, player, sitDown } from "./play.ts";

const DIR = process.env.SHOTS_DIR ?? "test-results/shots";
const WIDTHS = [1440, 390];
const SCHEMES = ["light", "dark"] as const;

test("landing, lobby, game and settings render without console errors", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  };

  const [white, black] = await sitDown(watch(await player(browser)), watch(await player(browser)));
  for (const [from, to, mover] of [
    ["e2", "e4", white],
    ["c7", "c5", black],
    ["g1", "f3", white],
    ["d7", "d6", black],
  ] as const)
    await move(mover, from, to, [white, black]);
  await white.getByTestId("chat").getByTestId("phrase").filter({ hasText: "Good luck" }).click();
  await expect(black.getByTestId("chat").getByTestId("chat-line")).toContainText(["Good luck"]);
  const game = white.url();

  const shoot = async (name: string, url: string, ready: string) => {
    for (const width of WIDTHS)
      for (const colorScheme of SCHEMES) {
        await white.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await white.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await white.goto(url);
        await expect(white.locator(ready).first()).toBeVisible();
        await white.waitForTimeout(400);
        const overflow = await white.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(overflow, `${name} at ${width} scrolls sideways`).toBeLessThanOrEqual(0);
        await white.screenshot({
          path: `${DIR}/${name}-${width}-${colorScheme}.png`,
          fullPage: true,
        });
      }
  };
  await shoot("landing", "/#/about", "main h1");
  await shoot("lobby", "/#/play", "[data-testid=relay-status]");
  await shoot("game", game, "[data-testid=chat]");
  await shoot("settings", "/#/settings", "[data-testid=settings-chat]");

  expect(errors).toEqual([]);
});
