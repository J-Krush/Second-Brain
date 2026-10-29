// spec: specs/search.md
// seed: tests/seed.spec.ts
import { expect, pressUntilVisible, test } from "./fixtures";

test.beforeEach(async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", {
    data: { title: `${marker} thought`, body: "body line for uat" },
  });
  expect(res.status()).toBe(201);
  track((await res.json()).card.id);
  await page.goto("/");
});

test("1–3. find by title and body, open with ↵", async ({ page, marker }) => {
  const palette = page.getByRole("dialog", { name: "Search" });
  const input = page.getByRole("combobox", { name: "Search" });

  await pressUntilVisible(page, "/", palette);
  await expect(input).toBeFocused();
  await input.fill(marker);
  await expect(palette).toContainText(`${marker} thought`);

  await input.fill(`${marker} body line`);
  await expect(palette).toContainText(`${marker} thought`);

  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/[?&]card=[0-9a-f-]{36}/);
  await expect(page.getByRole("dialog", { name: `${marker} thought` })).toBeVisible();
});

test("4. prefix of a word matches as you type", async ({ page, marker }) => {
  const palette = page.getByRole("dialog", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  await page.getByRole("combobox", { name: "Search" }).fill(marker.slice(0, -2));
  await expect(palette).toContainText(`${marker} thought`);
});

test("adversarial: Esc closes, / inside a text field types, blank query shows no error", async ({ page }) => {
  const palette = page.getByRole("dialog", { name: "Search" });
  const input = page.getByRole("combobox", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  await input.fill("   ");
  await expect(palette).not.toContainText(/error|no matches/i);
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  const capture = page.getByRole("dialog", { name: "Capture" });
  await pressUntilVisible(page, "Control+KeyJ", capture);
  await capture.locator("textarea").pressSequentially("a/b");
  await expect(capture.locator("textarea")).toHaveValue("a/b");
  await expect(palette).toBeHidden();
});

test("adversarial: every word must match, a word absent from the card excludes it", async ({ page, request, marker }) => {
  const hits = async (q: string) => {
    const body: { hits: { title: string | null }[] } = await (
      await request.get(`/api/search?mode=hybrid&q=${encodeURIComponent(q)}`)
    ).json();
    return body.hits.map((h) => h.title);
  };
  expect(await hits(`${marker} zqxbanana`)).not.toContain(`${marker} thought`);
  expect(await hits(`${marker} -thought`)).not.toContain(`${marker} thought`);

  const palette = page.getByRole("dialog", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  await page.getByRole("combobox", { name: "Search" }).fill(`${marker} zqxbanana`);
  await expect(palette).toContainText(/no matches/i);
});

test("adversarial: results belong to the final query even when its request fails", async ({ page, marker }) => {
  const palette = page.getByRole("dialog", { name: "Search" });
  const input = page.getByRole("combobox", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  await input.fill(marker);
  await expect(palette).toContainText(`${marker} thought`);

  // ~18 KB once URL-encoded: over the server's request-header limit, so the search request fails (431).
  await input.fill("中".repeat(2000));
  await expect(palette).not.toContainText(`${marker} thought`);
});
