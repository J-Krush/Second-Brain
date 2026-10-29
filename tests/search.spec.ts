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
