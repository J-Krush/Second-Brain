import { test as base, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export { expect };

interface Fixtures {
  /** Unique token for this test's data, so runs never collide with real cards. */
  marker: string;
  /** Records a created card id; it is soft-deleted (`DELETE /api/cards/:id`) after the test. */
  track: (cardId: string) => void;
}

/**
 * Tests run against a real database (local docker or a deployed preview), so
 * every card a test creates is tracked and soft-deleted afterwards. GC
 * hard-deletes it after 30 days.
 */
export const test = base.extend<Fixtures>({
  marker: async ({}, use, info) => {
    await use(`uat${info.workerIndex}x${Date.now().toString(36)}`);
  },
  track: async ({ request }, use) => {
    const ids: string[] = [];
    await use((id) => ids.push(id));
    for (const id of ids) await request.delete(`/api/cards/${id}`);
  },
});

/**
 * Presses a global hotkey until `target` shows. Server-rendered chrome is visible
 * before hydration attaches the window keydown listeners, so a single press can
 * land on nothing. Never re-presses once open, so toggling hotkeys stay safe.
 * Ctrl, not Meta: the handlers accept either, and headless Chromium only
 * reliably delivers Ctrl chords.
 */
export async function pressUntilVisible(page: Page, key: string, target: Locator): Promise<void> {
  await expect(async () => {
    if (!(await target.isVisible())) await page.keyboard.press(key);
    await expect(target).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Opens the capture dialog, types `text`, saves with ⌘↵, and returns the new card id. */
export async function capture(page: Page, text: string): Promise<string> {
  const dialog = page.getByRole("dialog", { name: "Capture" });
  await pressUntilVisible(page, "Control+KeyJ", dialog);
  await dialog.locator("textarea").fill(text);
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/cards") && r.request().method() === "POST",
  );
  await page.keyboard.press("Control+Enter");
  const res = await created;
  expect(res.status()).toBe(201);
  const body: { card: { id: string } } = await res.json();
  await expect(dialog).toBeHidden();
  return body.card.id;
}

/** Exact untriaged count from the API; the header badge loads after hydration, so it is not a baseline. */
export async function inboxCount(request: APIRequestContext): Promise<number> {
  const body: { inbox: number } = await (await request.get("/api/cards/count")).json();
  return body.inbox;
}

/** The header's inbox tab reads `inbox N`, or just `inbox` when nothing is untriaged. */
export async function expectInboxBadge(page: Page, count: number): Promise<void> {
  await expect(page.getByRole("navigation", { name: "scope" }).getByRole("link").first()).toHaveAccessibleName(
    count > 0 ? `inbox ${count}` : "inbox",
  );
}
