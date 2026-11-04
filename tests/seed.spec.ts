import { test, expect } from "@playwright/test";

// Seed for the Playwright planner/generator agents: an authenticated page on the
// inbox. The `chromium` project supplies the session via storageState, so tests
// only need to navigate.
test("seed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "scope" })).toBeVisible();
});
