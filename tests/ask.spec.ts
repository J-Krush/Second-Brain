// spec: specs/ask.md
// seed: tests/seed.spec.ts
import { expect, test } from "./fixtures";

test("1. sources list the matching card; answer or explicit provider error", async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", { data: { title: `${marker} thought`, body: "ask about me" } });
  track((await res.json()).card.id);

  await page.goto("/ask");
  const question = page.getByRole("textbox", { name: "Question" });
  await question.fill(`what do I know about ${marker}`);
  await question.press("Enter");

  await expect(page.getByText(`${marker} thought`).first()).toBeVisible();
  // Local dev without CF_* surfaces the provider error in the thread; deployed, an answer streams.
  await expect(page.getByText(/CF_ACCOUNT_ID \/ CF_AI_TOKEN not set|\[\d+\]|not in your notes/i).first()).toBeVisible({
    timeout: 30_000,
  });
});
