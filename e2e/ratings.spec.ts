import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { move, player, RATER_KEY, RELAY, sitDown } from "./play.ts";

test("a trusted rater's published rating replaces the local one and verifies when recomputed", async ({
  browser,
}) => {
  const [white, black] = await sitDown(await player(browser), await player(browser));
  for (const [i, squares] of ["f2f3", "e7e5", "g2g4", "d8h4"].entries())
    await move(i % 2 ? black : white, squares.slice(0, 2), squares.slice(2), [white, black]);
  await expect(black.getByTestId("signed")).toContainText("both players");
  await black.getByTestId("home").click();
  await expect(black.getByTestId("rating-source")).toContainText("computed in your browser from");
  await black.locator('.you a[href^="/player/"]').click();
  await expect(black.getByTestId("rated-by")).toContainText("Computed in this browser");
  await expect(black.getByTestId("verify")).toHaveCount(0);

  execFileSync("node", ["tools/rater.ts"], {
    env: { ...process.env, NOCHESS_RELAY: RELAY, NOCHESS_RATER_KEY: RATER_KEY },
  });
  await expect(black.getByTestId("rated-by")).toContainText("Published by rater");
  await black.getByTestId("verify").click();
  await expect(black.getByTestId("verified")).toContainText(
    /Verified: Recomputed from \d+ games\./,
  );
  await black.getByTestId("home").click();
  await expect(black.getByTestId("rating-source")).toContainText("published by the trusted rater");
  await expect(black.getByTestId("ranks").locator("li", { hasText: "(you)" })).toContainText(
    "1 game",
  );
});
