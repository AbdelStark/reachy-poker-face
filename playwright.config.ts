import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173/?preview=1",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
