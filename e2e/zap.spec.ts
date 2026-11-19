import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import {
  move,
  paid,
  PLATFORM,
  player,
  receiveZaps,
  RELAY,
  service,
  sitDown,
  zap,
  ZAP_HOST,
  ZAPMOCK_KEY,
} from "./play.ts";

const NO_WALLET = { "nochess:devwallet": "off" };
let reviewer: ChildProcess;

test.beforeAll(async () => {
  reviewer = await service(
    ["tools/reviewer.ts", "--serve"],
    {
      NOCHESS_REVIEWER_KEY: "4".repeat(64),
      NOCHESS_REVIEW_LUD16: `reviewer@${ZAP_HOST}`,
      NOCHESS_REVIEW_PAID_DEPTH: "6",
    },
    "serving",
  );
});
test.afterAll(() => void reviewer.kill());

test("a player is zapped from their profile, with a share for the platform that can be set to nothing", async ({
  browser,
}) => {
  const alice = await player(browser);
  const bob = await player(browser);
  const pubkey = await receiveZaps(alice, "alice");
  await bob.goto(`/#/player/${pubkey}`);
  await expect(bob.getByTestId("received")).toHaveText("0 sats in 0 zaps");

  await bob.getByTestId("zap").click();
  await expect(bob.getByTestId("zap-line").locator("b")).toHaveText(["85 sats", "15 sats"]);
  await zap(bob, 200, 0, ["200 sats"]);
  await paid(bob, 1);
  await bob.getByTestId("zap-close").click();
  await expect(bob.getByTestId("received")).toHaveText("200 sats in 1 zap");

  await bob.getByTestId("zap").click();
  await zap(bob, 200, 5, ["190 sats", "10 sats"]);
  await paid(bob, 2);
  await bob.getByTestId("zap-close").click();
  for (const page of [alice, bob]) {
    await page.goto(`/#/player/${pubkey}`);
    await expect(page.getByTestId("received")).toHaveText("390 sats in 2 zaps");
    await expect(page.getByTestId("zaps").locator("li")).toHaveCount(2);
  }
  await expect(bob.getByTestId("zaps").locator("li").first()).toContainText("(you)");
  await bob.goto(`/#/player/${PLATFORM}`);
  await expect(bob.getByTestId("zaps").locator("li", { hasText: "(you)" })).toContainText("10");
});

test("someone without a lightning address cannot be zapped", async ({ browser }) => {
  const alice = await player(browser);
  const bob = await player(browser);
  await alice.goto("/#/play");
  const href = await alice.locator('.you a[href^="#/player/"]').getAttribute("href");
  await bob.goto(`/${href}`);
  await expect(bob.getByTestId("profile")).toContainText("No lightning address");
  await expect(bob.getByTestId("zap")).toHaveCount(0);
});

test("without a wallet the invoice is shown as text and QR, and the zap completes when it is paid elsewhere", async ({
  browser,
  request,
}) => {
  const pubkey = await receiveZaps(await player(browser), "carol");
  const bob = await player(browser, undefined, NO_WALLET);
  await bob.goto(`/#/player/${pubkey}`);
  await bob.getByTestId("zap").click();
  await expect(bob.getByTestId("zap-sheet")).toContainText("No wallet connected");
  await zap(bob, 21, 0, ["21 sats"]);
  const invoice = await bob.getByTestId("bolt11").inputValue();
  expect(invoice).toMatch(/^lnbcrt210n1/);
  await expect(bob.locator(".invoice svg")).toBeVisible();
  await expect(bob.getByTestId("zap-line")).toHaveAttribute("data-state", "open");

  await request.post(`http://${ZAP_HOST}/pay`, { data: { invoice } });
  await paid(bob, 1);
  await expect(bob.getByTestId("bolt11")).toHaveCount(0);
});

test("a Nostr Wallet Connect wallet pays the zap", async ({ browser }) => {
  const pubkey = await receiveZaps(await player(browser), "dave");
  const bob = await player(browser, undefined, NO_WALLET);
  await bob.goto("/#/play");
  await bob.locator("details.wallet summary").click();
  await expect(bob.getByTestId("wallet")).toContainText("No wallet connected");
  await bob
    .getByTestId("nwc")
    .fill(
      `nostr+walletconnect://${getPublicKey(Buffer.from(ZAPMOCK_KEY, "hex"))}?relay=${encodeURIComponent(RELAY)}&secret=${"5".repeat(64)}`,
    );
  await bob.getByTestId("nwc").press("Enter");
  await expect(bob.getByTestId("wallet")).toContainText("Nostr Wallet Connect");
  await bob.goto(`/#/player/${pubkey}`);
  await bob.getByTestId("zap").click();
  await zap(bob, 50, 0, ["50 sats"]);
  await paid(bob, 1);
});

test("a watcher zaps both players of a game, and a player pays a reviewer for a review of it", async ({
  browser,
}) => {
  const [host, guest] = [await player(browser), await player(browser)];
  await receiveZaps(host, "host");
  await receiveZaps(guest, "guest");
  const [white, black] = await sitDown(host, guest);
  await move(white, "f2", "f3", [black]);
  await move(black, "e7", "e5", [white]);
  await move(white, "g2", "g4", [black]);

  const watcher = await player(browser);
  await watcher.goto("/#/play");
  await watcher.getByTestId("live").locator("a").first().click();
  await watcher.getByTestId("game-zaps").getByText("Zap both players").click();
  await zap(watcher, 101, 0, ["51 sats", "50 sats"]);
  await paid(watcher, 2);
  await watcher.getByTestId("zap-close").click();
  for (const page of [white, black, watcher]) {
    await expect(page.getByTestId("seat-0").getByTestId("zapped")).toHaveText("51");
    await expect(page.getByTestId("seat-1").getByTestId("zapped")).toHaveText("50");
    await expect(page.getByTestId("game-zaps")).toContainText("101 sats zapped on this game");
  }

  await move(black, "d8", "h4", [white, watcher]);
  await watcher.getByTestId("game-zaps").getByText("Zap the winner").click();
  await zap(watcher, 21, 0, ["21 sats"]);
  await paid(watcher, 1);
  await expect(white.getByTestId("seat-1").getByTestId("zapped")).toHaveText("71");

  await expect(white.getByTestId("signed")).toContainText("both players");
  await expect(white.getByTestId("labels")).toHaveCount(0);
  await white.getByTestId("request-review").click();
  await expect(white.getByTestId("request-review")).toHaveText("Request a review (50 sats)");
  const sheet = white.getByTestId("zap-sheet");
  await expect(sheet).toContainText("Ask Nochess reviewer for a review");
  await expect(sheet.getByTestId("zap-sats")).toHaveCount(0);
  await sheet.getByTestId("zap-go").click();
  await paid(white, 1);
  await sheet.getByTestId("zap-close").click();
  for (const page of [white, watcher]) {
    await expect(page.getByTestId("labels").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("labels")).toContainText("paid review by Nochess reviewer");
    await expect(page.getByTestId("labels")).toContainText("depth 6");
  }
  await expect(white.getByTestId("request-review")).toBeVisible();
});
