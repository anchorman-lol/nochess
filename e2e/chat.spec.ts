import { expect, test } from "@playwright/test";
import { move, player, sitDown } from "./play.ts";

test("players trade quick phrases, spectators talk in their own room, and chat can be switched off", async ({
  browser,
}) => {
  const [white, black] = await sitDown(await player(browser), await player(browser));
  await move(white, "e2", "e4", [black]);
  const gameUrl = white.url();

  // During the game a player has the quick phrases and no free text, and no spectators' room.
  const whiteChat = white.getByTestId("chat");
  await expect(whiteChat.getByTestId("chat-input")).toHaveCount(0);
  await expect(whiteChat.getByTestId("chat-room-spectators")).toHaveCount(0);
  await whiteChat.getByTestId("phrase").filter({ hasText: "Good luck" }).click();
  for (const page of [white, black])
    await expect(page.getByTestId("chat").getByTestId("chat-line")).toContainText(["Good luck"]);

  const watcher = await player(browser);
  await watcher.goto(gameUrl);
  const watcherChat = watcher.getByTestId("chat");
  await expect(watcherChat.getByTestId("chat-room-spectators")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await watcherChat.getByTestId("chat-input").fill("nice opening");
  await watcherChat.getByTestId("chat-input").press("Enter");
  await expect(watcherChat.getByTestId("chat-line")).toContainText(["nice opening"]);
  // The spectators' players tab is read-only and holds the players' phrase.
  await watcherChat.getByTestId("chat-room-players").click();
  await expect(watcherChat.getByTestId("chat-line")).toContainText(["Good luck"]);
  await expect(watcherChat.getByTestId("phrase")).toHaveCount(0);

  await black.getByTestId("chat").getByTestId("phrase").filter({ hasText: "Thanks" }).click();
  await expect(whiteChat.getByTestId("chat-line")).toHaveCount(2);
  await expect(whiteChat).not.toContainText("nice opening");

  await white.getByTestId("settings").click();
  await white.getByTestId("settings-chat").click();
  await white.goBack();
  await expect(white.getByTestId("table")).toBeVisible();
  await expect(white.getByTestId("chat")).toHaveCount(0);
});
