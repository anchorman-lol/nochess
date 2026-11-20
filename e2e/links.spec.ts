import { expect, test } from "@playwright/test";

test("a link from before real URLs opens the same page at its path", async ({ page }) => {
  await page.goto("/#/games/live");
  await expect(page).toHaveURL(/\/games\/live$/);
  await expect(page.getByRole("heading", { name: "Games" })).toBeVisible();

  await page.goto("/#/settings#profile");
  await expect(page).toHaveURL(/\/settings#profile$/);
});

test("a path that names no page goes home", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page).toHaveURL(/\/$/);
});
