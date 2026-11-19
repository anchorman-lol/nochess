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
    await expect(page.getByTestId("outcome")).toHaveText("0-1 Black wins by checkmate");
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
    await expect(page.getByTestId("outcome")).toHaveText("½-½ Draw by agreement");
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
    await expect(page.getByTestId("outcome")).toHaveText("0-1 Black wins by time", {
      timeout: 15_000,
    });
});

test("the computer in the browser answers a move", async ({ page }) => {
  await page.goto("/#/computer/1");
  await page.getByTestId("sq-e2").click();
  await page.getByTestId("sq-e4").click();
  await expect(page.getByTestId("moves").locator('[data-ply="2"]')).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText("Your move.");
});

test("a piece is dragged to its square, and a drag to an illegal square changes nothing", async ({
  page,
}) => {
  await page.goto("/#/computer/1");
  const board = page.getByTestId("board");
  const start = await board.getAttribute("data-fen");
  await page.getByTestId("sq-g1").dragTo(page.getByTestId("sq-g4"));
  await expect(board).toHaveAttribute("data-fen", start!);
  await page.getByTestId("sq-g1").dragTo(page.getByTestId("sq-f3"));
  await expect(page.getByTestId("moves").locator('[data-ply="1"]')).toHaveText("Nf3");
  await expect(page.getByTestId("moves").locator('[data-ply="2"]')).toBeVisible();
});

test("a pawn reaching the last rank promotes to the piece the player picks", async ({
  browser,
}) => {
  const [white, black] = await sitDown(await player(browser), await player(browser), false);
  const line = ["h2h4", "g7g5", "h4g5", "g8f6", "g5f6", "a7a6", "f6e7", "a6a5"];
  for (const [i, m] of line.entries()) {
    const [mover, other] = i % 2 ? [black, white] : [white, black];
    await move(mover, m.slice(0, 2), m.slice(2), [other]);
  }
  await white.getByTestId("sq-e7").click();
  await white.getByTestId("sq-d8").click();
  await expect(white.getByTestId("promotion")).toBeVisible();
  await white.getByTestId("promote-n").click();
  for (const page of [white, black]) {
    await expect(page.getByTestId("moves")).toContainText("exd8=N");
    await expect(page.getByTestId("sq-d8")).toHaveAttribute("aria-label", "d8 white n");
  }
  await expect(white.getByTestId("promotion")).toHaveCount(0);
});

test("a seek is withdrawn from the waiting screen, its lobby row or its tile, and then nobody can join it", async ({
  browser,
}) => {
  const [host, guest] = [await player(browser), await player(browser)];
  const seen = (hash: string) => guest.locator(`a[href="${hash}"]`);
  await host.goto("/");
  await guest.goto("/");

  await host.getByTestId("create").click();
  await expect(host.getByTestId("waiting")).toBeVisible();
  const first = new URL(host.url()).hash;
  await expect(seen(first)).toBeVisible();
  await host.getByTestId("cancel-seek").click();
  await expect(host.getByTestId("seeks")).toBeVisible();
  await expect(seen(first)).toHaveCount(0);
  await guest.goto(`/${first}`);
  await expect(guest.getByTestId("cancelled")).toHaveText("This seek was withdrawn.");
  await expect(guest.getByTestId("join")).toHaveCount(0);
  await guest.getByTestId("home").click();

  const tile = host.locator('[data-tc="600+0"]');
  const mine = host.getByTestId("my-seeks").locator("li");
  await tile.click();
  await expect(host.getByTestId("seeking")).toContainText("Seeking… Cancel");
  await expect(mine).toContainText("Your seek, waiting…");
  const second = (await mine.locator("a").getAttribute("href"))!;
  await expect(seen(second)).toBeVisible();
  await host.getByTestId("seeking").click();
  await expect(mine).toHaveCount(0);
  await expect(seen(second)).toHaveCount(0);

  await tile.click();
  const third = (await mine.locator("a").getAttribute("href"))!;
  await mine.getByTestId("cancel-seek").click();
  await expect(mine).toHaveCount(0);
  await expect(seen(third)).toHaveCount(0);

  // A seek that stays is admitted from the lobby, and its host follows it into the game.
  await tile.click();
  await seen((await mine.locator("a").getAttribute("href"))!).click();
  await guest.getByTestId("join").click();
  for (const page of [host, guest]) await expect(page.getByTestId("table")).toBeVisible();
});
