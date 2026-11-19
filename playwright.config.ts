import { defineConfig, devices } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { PLATFORM, RATER_KEY, RELAY, ZAP_HOST, ZAPMOCK_KEY } from "./e2e/play.ts";

const WEB_PORT = 5188;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "scripts/relay.sh e2e/relay.e2e.json",
      url: RELAY.replace("ws", "http"),
      timeout: 600_000,
      reuseExistingServer: false,
    },
    {
      command: "node tools/zapmock.ts",
      url: `http://${ZAP_HOST}/.well-known/lnurlp/ready`,
      env: {
        NOCHESS_RELAY: RELAY,
        NOCHESS_ZAP_PORT: ZAP_HOST.split(":")[1],
        NOCHESS_ZAPMOCK_KEY: ZAPMOCK_KEY,
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @nochess/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: {
        VITE_RELAY_URL: RELAY,
        VITE_RATERS: getPublicKey(Buffer.from(RATER_KEY, "hex")),
        VITE_DEV_WALLET: `http://${ZAP_HOST}`,
        VITE_PLATFORM_LUD16: `nochess@${ZAP_HOST}`,
        VITE_PLATFORM_PUBKEY: PLATFORM,
      },
      reuseExistingServer: false,
    },
  ],
});
