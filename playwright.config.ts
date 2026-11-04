import { defineConfig, devices } from "@playwright/test";

// Runs against an already-running app: `pnpm dev` (default), `pnpm preview`, or a
// deployed URL via UAT_BASE_URL. There is deliberately no `webServer` block — the
// e2e suite is a UAT tool pointed at whatever you want to verify, not a CI fixture.
// UAT_VIDEO=on records every test, for review receipts.
const baseURL = process.env.UAT_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "tests",
  outputDir: "tests/.results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "tests/.report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: process.env.UAT_VIDEO === "on" ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Login once (the route is rate-limited to 5 attempts/min) and share the sealed cookie.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/state.json" },
      dependencies: ["setup"],
    },
  ],
});
