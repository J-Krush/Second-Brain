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

test("3. capture a link: OG title appears without reload", async ({ page, marker, track }) => {
  // A unique query string, so the card cannot be confused with an earlier example.com card.
  const url = `https://example.com/?uat=${marker}`;
  const dialog = page.getByRole("dialog", { name: "Capture" });
  await pressUntilVisible(page, "Control+KeyJ", dialog);
  const kind = dialog.locator('button[aria-haspopup="listbox"]');
  await expect(kind).toHaveText(/thought/);
  await dialog.locator("textarea").fill(url);
  await expect(kind).toHaveText(/link/);
  track(await capture(page, url));

  const card = page.locator("article").filter({ has: page.locator(`a[href="${url}"]`) });
  await expect(card).toContainText("example.com");
  await expect(card).toContainText("Example Domain", { timeout: 10_000 });
});

test("4. + add button opens the same dialog", async ({ page }) => {
  await page.getByRole("button", { name: /add/i }).click();
  await expect(page.getByRole("dialog", { name: "Capture" })).toBeVisible();
});

test("5. kind → link in the editor: OG title appears without reload", async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", { data: { body: `${marker} convert me` } });
  expect(res.status()).toBe(201);
  const id: string = (await res.json()).card.id;
  track(id);
  const url = `https://example.com/?uat=${marker}`;

  await page.goto(`/?card=${id}`);
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "edit" }).click();
  await modal.getByRole("combobox").selectOption("link");
  await modal.getByPlaceholder("https://…").fill(url);
  await modal.getByRole("button", { name: /^save$/i }).click();

  await expect(modal).toContainText("Example Domain", { timeout: 10_000 });
  // The modal renders its own <article>; this is the stream card underneath it.
  const card = page.locator("article:not([role=dialog] *)").filter({ has: page.locator(`a[href="${url}"]`) });
  await expect(card).toContainText("Example Domain");
  const detail: { card: { type: string; title: string | null } } = await (await request.get(`/api/cards/${id}`)).json();
  expect(detail.card).toMatchObject({ type: "link", title: "Example Domain" });
});

test("adversarial: whitespace cannot be captured; double ⌘↵ creates one card", async ({ page, request, marker, track }) => {
  const dialog = page.getByRole("dialog", { name: "Capture" });
  await pressUntilVisible(page, "Control+KeyJ", dialog);
  await dialog.locator("textarea").fill("  \n\t ");
  await expect(dialog.getByRole("button", { name: "capture" })).toBeDisabled();

  const before = await inboxCount(request);
  const posts: string[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/cards") && r.request().method() === "POST" && r.status() === 201) {
      const id: string = (await r.json()).card.id;
      posts.push(id);
      track(id);
    }
  });
  await dialog.locator("textarea").fill(`${marker} once`);
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(dialog).toBeHidden();
  await expect.poll(() => inboxCount(request)).toBe(before + 1);
  await page.waitForTimeout(1000);
  expect(posts).toHaveLength(1);
});

test("adversarial: 390px viewport, the dialog fits without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole("dialog", { name: "Capture" });
  await pressUntilVisible(page, "Control+KeyJ", dialog);
  await dialog.locator("textarea").fill(`https://example.com/${"x".repeat(200)}`);
  const button = await dialog.getByRole("button", { name: "capture" }).boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
