// spec: specs/card-triage.md
// seed: tests/seed.spec.ts
import { expect, expectInboxBadge, inboxCount, test } from "./fixtures";

let cardId = "";

test.beforeEach(async ({ request, marker, track }) => {
  const res = await request.post("/api/cards", { data: { title: `${marker} thought`, body: "triage me" } });
  expect(res.status()).toBe(201);
  cardId = (await res.json()).card.id;
  track(cardId);
});

test("1. modal is URL state: survives reload, back closes it", async ({ page, marker }) => {
  await page.goto("/");
  await page.goto(`/?card=${cardId}`);
  const modal = page.getByRole("dialog", { name: `${marker} thought` });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("typed");

  await page.reload();
  await expect(modal).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/card=/);
  await expect(modal).toBeHidden();
});

test("2. archive with e", async ({ page, request, marker }) => {
  const before = await inboxCount(request);
  await page.goto(`/?card=${cardId}`);
  await expect(page.getByRole("dialog", { name: `${marker} thought` })).toBeVisible();

  await page.keyboard.press("e");
  await expect(page.getByText("archived to library")).toBeVisible();
  await expectInboxBadge(page, before - 1);

  await page.goto("/?scope=library");
  await expect(page.getByText(`${marker} thought`)).toBeVisible();
});

test("3. tag with t triages; e typed in the tag input does not archive", async ({ page, request, marker }) => {
  const before = await inboxCount(request);
  await page.goto(`/?card=${cardId}`);
  const modal = page.getByRole("dialog", { name: `${marker} thought` });
  await expect(modal).toBeVisible();

  await page.keyboard.press("t");
  const input = modal.getByRole("textbox", { name: "+ tag" });
  await expect(input).toBeFocused();
  await input.pressSequentially(`${marker}e`);
  await expect(page.getByText("archived to library")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(modal.getByRole("button", { name: `Remove ${marker}e` })).toBeVisible();

  let tagIds: number[] = [];
  await expect
    .poll(async () => {
      const detail: { tags: { id: number }[] } = await (await request.get(`/api/cards/${cardId}`)).json();
      tagIds = detail.tags.map((t) => t.id);
      return tagIds.length;
    })
    .toBe(1);
  try {
    // API contract: attaching a tag auto-triages. The UI should reflect it without a reload.
    expect(await inboxCount(request)).toBe(before - 1);
    await expect(modal).not.toContainText("untriaged");
    await expectInboxBadge(page, before - 1);
  } finally {
    for (const id of tagIds) await request.delete(`/api/tags/${id}`);
  }
});

test("adversarial: unknown card id does not crash", async ({ page }) => {
  await page.goto("/?card=00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("navigation", { name: "scope" })).toBeVisible();
  await expect(page.getByText(/application error|unhandled/i)).toHaveCount(0);
});
