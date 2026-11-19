import { expect, test } from "@playwright/test";
import { move, player, sitDown } from "./play.ts";

test("two players play a rated game to checkmate, watched, archived and audited", async ({
  browser,
}) => {
  const [white, black] = await sitDown(await player(browser), await player(browser));
  const both = [white, black];
  await expect(white.getByTestId("status")).toHaveText("Your move.");
  await expect(black.getByTestId("status")).toHaveText("Waiting for White.");
  await expect(white.getByTestId("abort")).toBeVisible();

  await move(white, "f2", "f3", [black]);
  await move(black, "e7", "e5", [white]);
  await expect(white.getByTestId("clock-0")).toHaveText(/^(5:00|4:5\d)$/);
  await expect(white.getByTestId("resign")).toBeVisible();

  const watcher = await player(browser);
  await watcher.goto("/");
  await watcher.getByTestId("live").locator("a").first().click();
  await expect(watcher.getByTestId("status")).toContainText("You are watching");
  await expect(watcher.getByTestId("moves")).toContainText("e5");

  await move(white, "g2", "g4", [black, watcher]);
  await move(black, "d8", "h4", [white, watcher]);
  for (const page of [...both, watcher]) {
    await expect(page.getByTestId("outcome")).toHaveText("0-1 · Black wins by checkmate");
    await expect(page.getByTestId("signed")).toContainText("both players");
    await expect(page.getByTestId("moves")).toContainText("Qh4#");
  }

  await black.getByTestId("home").click();
  await expect(black.getByTestId("audit")).toContainText("checked out");
  await expect(black.getByTestId("results").locator("li", { hasText: "(you)" })).toContainText(
    "checkmate · 5+3 blitz, rated",
  );
  const rank = black.getByTestId("ranks").locator("li", { hasText: "(you)" });
  await expect(rank).toContainText("blitz");
  await expect(rank).toContainText("1 game");
});

test("a draw is offered and accepted, and a casual game leaves no rating", async ({ browser }) => {
  const [white, black] = await sitDown(await player(browser), await player(browser), false);
  await move(white, "e2", "e4", [black]);
  await move(black, "e7", "e5", [white]);
  await white.getByTestId("draw-offer").click();
  await black.getByTestId("draw-accept").click();
  for (const page of [white, black])
    await expect(page.getByTestId("outcome")).toHaveText("1/2-1/2 · Draw by agreement");
  await expect(white.getByTestId("signed")).toContainText("both players");
  await white.getByTestId("home").click();
  await expect(white.getByTestId("results").locator("li", { hasText: "(you)" })).toContainText(
    "agreement",
  );
  await expect(white.getByTestId("ranks").locator("li", { hasText: "(you)" })).toHaveCount(0);
});

test("a game can be aborted before both have moved", async ({ browser }) => {
  const [white, black] = await sitDown(await player(browser), await player(browser));
  await move(white, "e2", "e4", [black]);
  await black.getByTestId("abort").click();
  for (const page of [white, black])
    await expect(page.getByTestId("outcome")).toHaveText("Game aborted");
});

test("the player whose clock runs out loses on time", async ({ browser }) => {
  // One second plus five a move still counts as blitz, and White's second runs out at once.
  const [white, black] = await sitDown(await player(browser, "1+5"), await player(browser));
  await move(white, "e2", "e4", [black]);
  await move(black, "e7", "e5", [white]);
  for (const page of [white, black])
    await expect(page.getByTestId("outcome")).toHaveText("0-1 · Black wins by time", {
      timeout: 15_000,
    });
});

test("the computer in the browser answers a move", async ({ page }) => {
  await page.goto("/#/computer/1");
  await page.getByTestId("sq-e2").click();
  await page.getByTestId("sq-e4").click();
  await expect(page.locator(".moves li span").nth(1)).not.toBeEmpty();
  await expect(page.getByTestId("status")).toHaveText("Your move.");
});
