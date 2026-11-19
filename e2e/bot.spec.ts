import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { Chess } from "chess.js";
import { getPublicKey } from "nostr-tools/pure";
import { paid, service, stored, ZAP_HOST } from "./play.ts";

const PAYBOT_KEY = Buffer.from("3".repeat(64), "hex");

let bots: ChildProcess[];

test.beforeAll(async () => {
  const env = { LUFT_BOT_MS: "30" };
  bots = await Promise.all([
    service(["tools/bot.ts"], { ...env, LUFT_BOT_KEY: "1".repeat(64) }, "ready"),
    service(
      ["tools/bot.ts"],
      {
        ...env,
        LUFT_BOT_ID: "paybot",
        LUFT_PAYBOT_KEY: PAYBOT_KEY.toString("hex"),
        LUFT_BOT_NAME: "Paybot",
        LUFT_BOT_PRICE: "21",
        LUFT_BOT_LUD16: `paybot@${ZAP_HOST}`,
        LUFT_BOT_SPEEDS: "blitz,rapid",
      },
      "ready",
    ),
  ]);
});
test.afterAll(() => bots.forEach((bot) => bot.kill()));

/** The human plays any legal move, picked by a fixed sequence, until the game is over. */
async function playOut(page: Page) {
  const table = page.getByTestId("table");
  await expect(table).toBeVisible();
  const seat = await table.getAttribute("data-seat");
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
}

test("a player challenges the bot account and plays a rated game to the end", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  const row = page.getByTestId("bots").locator("li", { hasText: "Luftbot" });
  await expect(row.locator(".bot")).toHaveText("BOT");
  await expect(row.getByTestId("challenge-bot")).toHaveText("Challenge");
  await row.getByTestId("challenge-bot").click();
  await playOut(page);
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

test("a bot with a price joins only once the challenge is paid, and then plays", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");
  const row = page.getByTestId("bots").locator("li", { hasText: "Paybot" });
  await expect(row.getByTestId("challenge-bot")).toHaveText("Challenge · 21 sats");
  await page.getByTestId("tc").selectOption("1800+0");
  await expect(row.getByTestId("challenge-bot")).toBeDisabled();
  await page.getByTestId("tc").selectOption("300+3");
  await row.getByTestId("challenge-bot").click();

  await expect(page.getByTestId("pay-fee")).toHaveText("Pay 21 sats to start");
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("waiting")).toBeVisible();
  await page.getByTestId("pay-fee").click();
  const sheet = page.getByTestId("zap-sheet");
  await expect(sheet).toContainText("There are no refunds.");
  await expect(sheet.getByTestId("zap-line")).toHaveCount(1);
  await sheet.getByTestId("zap-go").click();
  await paid(page, 1);
  await sheet.getByTestId("zap-close").click();

  await playOut(page);
  await expect(page.getByTestId("table").getByTestId("zapped")).toHaveText("21");
  // The bot's join names the receipt it spent, for anyone to check.
  const [join] = await stored({ kinds: [1640], authors: [getPublicKey(PAYBOT_KEY)] });
  const paidBy = join.tags.find((tag) => tag[0] === "e")![1];
  expect(await stored({ ids: [paidBy], kinds: [9735] })).toHaveLength(1);
});
