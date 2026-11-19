import { defineConfig, devices } from "@playwright/test";

const RELAY_PORT = 7788;
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
      url: `http://127.0.0.1:${RELAY_PORT}`,
      timeout: 600_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { VITE_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
