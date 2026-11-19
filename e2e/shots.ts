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
      NOCHESS_BOT_ID: "paybot",
      NOCHESS_PAYBOT_KEY: "3".repeat(64),
      NOCHESS_BOT_NAME: "Paybot the Patient Positional Pro",
      NOCHESS_BOT_PRICE: "21",
      NOCHESS_BOT_LUD16: `paybot@${ZAP_HOST}`,
    },
    "ready",
  );
  const freebot = await service(["tools/bot.ts"], { NOCHESS_BOT_KEY: "1".repeat(64) }, "ready");
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
  const shoot = async (
    name: string,
    ready: string,
    url?: string,
    page = white,
    widths = WIDTHS,
  ) => {
    for (const width of widths)
      for (const colorScheme of SCHEMES) {
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        if (url) await page.goto(url);
        await expect(page.locator(ready).first()).toBeVisible();
        if (!url) await page.locator(ready).first().scrollIntoViewIfNeeded();
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
  await shoot("games", "[data-testid=list-rows]", "/#/games");
  await shoot("leaderboard", "[data-testid=list-rows]", "/#/leaderboard");

  const [first] = await sitDown(watch(await player(browser)), watch(await player(browser)));
  await shoot("first-move", "[data-testid=first-move-countdown]", undefined, first);

  await guest.goto("/#/settings#profile");
  const editor = guest.getByTestId("profile-editor");
  await editor.getByLabel("Name", { exact: true }).fill("guest");
  await editor.getByLabel("Display name").fill("The Guest");
  await editor.getByLabel("About").fill("Plays the Caro-Kann, slowly.");
  await editor.getByTestId("profile-save").click();
  await expect(editor.getByRole("status")).toHaveText("Published.");
  await expect(editor.getByLabel("Lightning address")).toHaveValue(`guest@${ZAP_HOST}`);
  await shoot("profile", "[data-testid=profile-editor]", undefined, guest);

  await white.goto("/#/play");
  await white.getByTestId("relay-status").click();
  await white.getByTestId("relay-add").fill("wss://relay.example/");
  await white.getByTestId("relay-add").press("Enter");
  await expect(white.getByTestId("relay")).toHaveCount(2);
  await shoot("relays", "[data-testid=relays]", undefined, white);
  await white.keyboard.press("Escape");

  const watcher = watch(await player(browser));
  await watcher.goto(game);
  await watcher.getByTestId("game-zaps").getByText("Zap both players").click();
  await zap(watcher, 210, 5, ["100 sats", "100 sats", "10 sats"]);
  await expect(watcher.locator('[data-testid="zap-line"][data-state="paid"]')).toHaveCount(3);
  await shoot("zap", "[data-testid=zap-close]", undefined, watcher);

  const payer = watch(await player(browser, undefined, { "nochess:devwallet": "off" }));
  await payer.goto(`/#/player/${hostKey}`);
  await payer.getByTestId("zap").click();
  await zap(payer, 21, 0, ["21 sats"]);
  await shoot("invoice", ".invoice svg", undefined, payer);

  const challenger = watch(await player(browser));
  await challenger.goto("/#/play");
  await challenger.getByRole("tab", { name: "A bot" }).click();
  const botRows = challenger.getByTestId("bots").locator("li");
  await expect(botRows.filter({ hasText: "Nochess bot" })).toBeVisible();
  for (const width of [1440, 1024, 768, 390]) {
    await shoot("lobby-bots", "[data-testid=bot-status]", undefined, challenger, [width]);
    const heights = await botRows.evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height),
    );
    expect(new Set(heights).size, `bot rows at ${width} are ${heights} px high`).toBe(1);
  }
  const paybotRow = botRows.filter({ hasText: "Paybot" });
  for (const width of [1440, 390]) {
    await challenger.setViewportSize({ width, height: 844 });
    await paybotRow.getByTestId("bot-info").press("Enter");
    await shoot("lobby-bot-record", "[data-testid=bot-record]", undefined, challenger, [width]);
    await challenger.keyboard.press("Escape");
  }
  const capped = watch(
    await player(browser, undefined, { "nochess:settings": JSON.stringify({ newBotCap: 10 }) }),
  );
  await capped.goto("/#/play");
  await capped.getByRole("tab", { name: "A bot" }).click();
  for (const width of [1440, 390]) {
    await capped.setViewportSize({ width, height: 844 });
    await capped
      .getByTestId("bots")
      .locator("li", { hasText: "Paybot" })
      .getByTestId("challenge-bot")
      .press("Enter");
    await shoot("lobby-bot-blocked", "[data-testid=challenge-blocked] a", undefined, capped, [
      width,
    ]);
    await capped.keyboard.press("Escape");
  }
  await paybotRow.getByTestId("challenge-bot").click();
  await shoot("waiting", "[data-testid=join-countdown]", undefined, challenger);
  await challenger.getByTestId("pay-fee").click();
  await shoot("paid-bot", "[data-testid=zap-go]", undefined, challenger);
  paybot.kill();
  freebot.kill();

  expect(errors).toEqual([]);
});
