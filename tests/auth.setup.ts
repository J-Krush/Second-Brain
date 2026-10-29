import { existsSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { SESSION_COOKIE, sealSession } from "../src/lib/session";

/**
 * Authenticates once and saves the session for every other test.
 *
 * - `UAT_PASSWORD` set: logs in through the real /login form. Required for a
 *   deployed target, whose SESSION_SECRET you do not have locally.
 * - Otherwise: seals the same cookie `/api/auth/login` issues, using
 *   SESSION_SECRET from `.env.local`. Local dev only stores the password hash.
 */
setup("login", async ({ page, baseURL }) => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const password = process.env.UAT_PASSWORD;

  if (password) {
    await page.goto("/login");
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Enter" }).click();
  } else {
    if (!process.env.SESSION_SECRET) throw new Error("Set UAT_PASSWORD, or SESSION_SECRET in .env.local");
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: await sealSession({ authenticated: true, createdAt: Date.now() }),
        url: baseURL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/");
  }

  await expect(page.getByRole("navigation", { name: "scope" })).toBeVisible();
  await page.context().storageState({ path: "tests/.auth/state.json" });
});
