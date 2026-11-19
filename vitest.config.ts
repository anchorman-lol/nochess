import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      { test: { name: "tools", include: ["tools/*.test.ts"] } },
    ],
  },
});
