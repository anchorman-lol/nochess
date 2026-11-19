import { type ChildProcess, spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Chess } from "chess.js";
import { RELAY } from "./play.ts";

let bot: ChildProcess;

test.beforeAll(async () => {
  bot = spawn("node", ["tools/bot.ts"], {
    env: { ...process.env, LUFT_RELAY: RELAY, LUFT_BOT_MS: "30", LUFT_BOT_KEY: "1".repeat(64) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    bot.stdout!.on("data", (chunk) => String(chunk).includes("ready") && resolve());
    bot.on("exit", (code) => reject(new Error(`the bot exited with ${code}`)));
  });
});
test.afterAll(() => void bot.kill());

test("a player challenges the bot account and plays a rated game to the end", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  const row = page.getByTestId("bots").locator("li", { hasText: "Luftbot" });
  await expect(row.locator(".bot")).toHaveText("BOT");
  await row.getByTestId("challenge-bot").click();
  const table = page.getByTestId("table");
  await expect(table).toBeVisible();
  const seat = await table.getAttribute("data-seat");

  // The human plays any legal move, picked by a fixed sequence; the bot does the rest.
  let pick = 7;
  for (let moves = 0; moves < 200; moves++) {
    await expect(table).toHaveAttribute("data-turn", new RegExp(`^(${seat})?$`), {
      timeout: 20_000,
    });
    if ((await table.getAttribute("data-turn")) === "") break;
    const fen = (await page.getByTestId("board").getAttribute("data-fen"))!;
    const legal = new Chess(fen).moves({ verbose: true });
    pick = (pick * 31 + 11) % 1009;
    const { from, to, promotion } = legal[pick % legal.length];
    await page.getByTestId(`sq-${from}`).click();
    await page.getByTestId(`sq-${to}`).click();
    if (promotion) await page.getByTestId(`promote-${promotion}`).click();
    await expect(page.getByTestId("board")).not.toHaveAttribute("data-fen", fen);
  }

  await expect(page.getByTestId("outcome")).toContainText(/wins by checkmate|Draw by/);
  await expect(page.getByTestId("signed")).toContainText("both players");
  await page.getByTestId("home").click();
  const result = page.getByTestId("results").locator("li", { hasText: "Luftbot" });
  await expect(result).toContainText("(you)");
  await expect(result).toContainText("rated");
  await expect(page.getByTestId("ranks").locator("li", { hasText: "(you)" })).toContainText(
    "blitz",
  );
  await expect(page.getByTestId("bots").locator("li", { hasText: "Luftbot" })).toContainText(
    /\d{4}/,
  );
});
