// spec: specs/capture.md
// seed: tests/seed.spec.ts
import { capture, expect, expectInboxBadge, inboxCount, pressUntilVisible, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("1. capture a thought with ⌘J", async ({ page, request, marker, track }) => {
  const before = await inboxCount(request);
  track(await capture(page, `# ${marker} thought\nbody line`));

  await expect(page.getByText("captured → inbox")).toBeVisible();
  await expectInboxBadge(page, before + 1);
  const card = page.locator("article").filter({ hasText: `${marker} thought` });
  await expect(card).toContainText("body line");
  await expect(card).toContainText("typed");
});

test("2. dismiss without saving", async ({ page, request, marker }) => {
  const before = await inboxCount(request);
  const dialog = page.getByRole("dialog", { name: "Capture" });

  await pressUntilVisible(page, "Control+KeyJ", dialog);
  await expect(dialog.getByRole("button", { name: "capture" })).toBeDisabled();
  await dialog.locator("textarea").fill(marker);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.keyboard.press("Control+KeyJ");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Control+KeyJ");
  await expect(dialog).toBeHidden();

  expect(await inboxCount(request)).toBe(before);
  await page.reload();
  await expect(page.getByText(marker)).toHaveCount(0);
});

test("3. capture a link: OG title appears without reload", async ({ page, track }) => {
  track(await capture(page, "https://example.com/"));

  const card = page.locator("article").filter({ hasText: "example.com" }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Example Domain", { timeout: 10_000 });
});

test("4. + add button opens the same dialog", async ({ page }) => {
  await page.getByRole("button", { name: /add/i }).click();
  await expect(page.getByRole("dialog", { name: "Capture" })).toBeVisible();
});
