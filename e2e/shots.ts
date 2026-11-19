import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { move, player, receiveZaps, service, sitDown, zap, ZAP_HOST } from "./play.ts";

const DIR = process.env.SHOTS_DIR ?? "test-results/shots";
const WIDTHS = [1440, 390];
const SCHEMES = ["light", "dark"] as const;

test("landing, lobby, game, settings, zaps, a paid bot and an invoice render without console errors", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  };

  const paybot = await service(
    ["tools/bot.ts"],
    {
      LUFT_BOT_ID: "paybot",
      LUFT_PAYBOT_KEY: "3".repeat(64),
      LUFT_BOT_NAME: "Paybot",
      LUFT_BOT_PRICE: "21",
      LUFT_BOT_LUD16: `paybot@${ZAP_HOST}`,
    },
    "ready",
  );
  const [host, guest] = [watch(await player(browser)), watch(await player(browser))];
  const hostKey = await receiveZaps(host, "host");
  await receiveZaps(guest, "guest");
  const [white, black] = await sitDown(host, guest);
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

  /** Shoots `page` at each width and scheme; `url` reloads it first, without one an open sheet stays. */
  const shoot = async (name: string, ready: string, url?: string, page = white) => {
    for (const width of WIDTHS)
      for (const colorScheme of SCHEMES) {
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        if (url) await page.goto(url);
        await expect(page.locator(ready).first()).toBeVisible();
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(overflow, `${name} at ${width} scrolls sideways`).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `${DIR}/${name}-${width}-${colorScheme}.png`,
          fullPage: !!url,
        });
      }
  };
  await shoot("landing", "main h1", "/#/about");
  await shoot("lobby", "[data-testid=relay-status]", "/#/play");
  await shoot("game", "[data-testid=chat]", game);
  await shoot("settings", "[data-testid=settings-chat]", "/#/settings");

  const watcher = watch(await player(browser));
  await watcher.goto(game);
  await watcher.getByTestId("game-zaps").getByText("Zap both players").click();
  await zap(watcher, 210, 5, ["100 sats", "100 sats", "10 sats"]);
  await expect(watcher.locator('[data-testid="zap-line"][data-state="paid"]')).toHaveCount(3);
  await shoot("zap", "[data-testid=zap-close]", undefined, watcher);

  const payer = watch(await player(browser, undefined, { "luft:devwallet": "off" }));
  await payer.goto(`/#/player/${hostKey}`);
  await payer.getByTestId("zap").click();
  await zap(payer, 21, 0, ["21 sats"]);
  await shoot("invoice", ".invoice svg", undefined, payer);

  const challenger = watch(await player(browser));
  await challenger.goto("/#/play");
  await challenger.getByRole("tab", { name: "A bot" }).click();
  await challenger
    .getByTestId("bots")
    .locator("li", { hasText: "Paybot" })
    .getByTestId("challenge-bot")
    .click();
  await challenger.getByTestId("pay-fee").click();
  await shoot("paid-bot", "[data-testid=zap-go]", undefined, challenger);
  paybot.kill();

  expect(errors).toEqual([]);
});
