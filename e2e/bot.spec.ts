import type { ChildProcess } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { Chess } from "chess.js";
import { getPublicKey } from "nostr-tools/pure";
import { paid, service, stored, ZAP_HOST } from "./play.ts";

const PAYBOT_KEY = Buffer.from("3".repeat(64), "hex");

let bots: ChildProcess[];
const env = { NOCHESS_BOT_MS: "30" };
const freeBot = () =>
  service(["tools/bot.ts"], { ...env, NOCHESS_BOT_KEY: "1".repeat(64) }, "ready");

test.beforeAll(async () => {
  bots = await Promise.all([
    freeBot(),
    service(
      ["tools/bot.ts"],
      {
        ...env,
        NOCHESS_BOT_ID: "paybot",
        NOCHESS_PAYBOT_KEY: PAYBOT_KEY.toString("hex"),
        NOCHESS_BOT_NAME: "Paybot",
        NOCHESS_BOT_PRICE: "21",
        NOCHESS_BOT_LUD16: `paybot@${ZAP_HOST}`,
        NOCHESS_BOT_SPEEDS: "blitz,rapid",
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
  await page.goto("/play");
  await page.getByRole("tab", { name: "A bot" }).click();
  const row = page.getByTestId("bots").locator("li", { hasText: "Nochess bot" });
  await expect(row.locator(".bot")).toHaveText("BOT");
  await expect(row.getByTestId("challenge-bot")).toHaveText("Challenge");
  await row.getByTestId("bot-info").hover();
  await expect(page.getByTestId("bot-record")).toContainText(/new bot|answered/);
  await expect(page.getByTestId("bot-record")).toContainText("withdraws itself");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("bot-record")).toBeHidden();
  await row.getByTestId("challenge-bot").click();
  await playOut(page);
  await page.getByTestId("home").click();
  const result = page.getByTestId("results").locator("li", { hasText: "Nochess bot" });
  await expect(result).toContainText("(you)");
  await expect(result).toContainText("rated");
  await expect(page.getByTestId("ranks").locator("li", { hasText: "(you)" })).toContainText(
    "blitz",
  );
  await page.getByRole("tab", { name: "A bot" }).click();
  await expect(page.getByTestId("bots").locator("li", { hasText: "Nochess bot" })).toContainText(
    /\d{4}/,
  );
});

test("a bot that restarts mid-game still answers the moves of the games it sits in", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/play");
  await page.getByRole("tab", { name: "A bot" }).click();
  await page
    .getByTestId("bots")
    .locator("li", { hasText: "Nochess bot" })
    .getByTestId("challenge-bot")
    .click();
  const table = page.getByTestId("table");
  await expect(table).toBeVisible();
  const seat = (await table.getAttribute("data-seat"))!;
  await expect(table).toHaveAttribute("data-turn", seat);
  bots[0].kill();
  bots[0] = await freeBot();
  const fen = (await page.getByTestId("board").getAttribute("data-fen"))!;
  const [{ from, to }] = new Chess(fen).moves({ verbose: true });
  await page.getByTestId(`sq-${from}`).click();
  await page.getByTestId(`sq-${to}`).click();
  await expect(table).not.toHaveAttribute("data-turn", seat);
  await expect(table).toHaveAttribute("data-turn", seat, { timeout: 20_000 });
});

test("a new bot priced over the cap says why it is blocked and links to the cap", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByTestId("settings-bot-cap").fill("10");
  await page.goto("/play");
  await page.getByRole("tab", { name: "A bot" }).click();
  const challenge = page
    .getByTestId("bots")
    .locator("li", { hasText: "Paybot" })
    .getByTestId("challenge-bot");
  await expect(challenge).toBeDisabled();
  await challenge.hover();
  const why = page.getByTestId("challenge-blocked");
  await expect(why).toHaveText(
    "21 sats is over your 10-sat cap for bots without a record. Raise it in Settings.",
  );
  await page.mouse.move(0, 0);
  await expect(why).toBeHidden();
  await challenge.focus();
  await page.keyboard.press("Enter");
  await why.getByRole("link", { name: "Raise it in Settings" }).click();
  await expect(page).toHaveURL(/\/settings#bot-cap$/);
  const cap = page.getByTestId("settings-bot-cap");
  await expect(cap).toBeFocused();
  await cap.fill("100");
  await page.goto("/play");
  await page.getByRole("tab", { name: "A bot" }).click();
  await expect(challenge).toBeEnabled();
});

test("a bot with a price joins only once the challenge is paid, and then plays", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/play");
  await page.getByRole("tab", { name: "A bot" }).click();
  const row = page.getByTestId("bots").locator("li", { hasText: "Paybot" });
  await expect(row.getByTestId("challenge-bot")).toHaveText("Challenge · 21 sats");
  const time = (label: string) =>
    page.getByRole("radiogroup", { name: "Time" }).getByText(label, { exact: true }).click();
  await time("30+0");
  await expect(row.getByTestId("challenge-bot")).toBeDisabled();
  await time("5+3");
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
