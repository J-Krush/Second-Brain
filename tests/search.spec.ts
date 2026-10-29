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

test("adversarial: a last term with inner punctuation still matches as a whole term", async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", {
    data: { title: `${marker} stack`, body: "notes on node.js, example.com and v1.2" },
  });
  expect(res.status()).toBe(201);
  track((await res.json()).card.id);

  const titles = async (q: string) => {
    const body: { hits: { title: string | null }[] } = await (
      await request.get(`/api/search?mode=hybrid&q=${encodeURIComponent(q)}`)
    ).json();
    return body.hits.map((h) => h.title);
  };
  expect(await titles(`node.js ${marker}`)).toContain(`${marker} stack`);
  for (const term of ["node.js", "example.com", "v1.2"]) {
    expect(await titles(`${marker} ${term}`), term).toContain(`${marker} stack`);
  }

  const palette = page.getByRole("dialog", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  await page.getByRole("combobox", { name: "Search" }).fill(`${marker} node.js`);
  await expect(palette).toContainText(`${marker} stack`);
});

test("4. prefix of an inflected word matches while typing", async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", { data: { title: `${marker} running shoes` } });
  expect(res.status()).toBe(201);
  track((await res.json()).card.id);

  const palette = page.getByRole("dialog", { name: "Search" });
  const input = page.getByRole("combobox", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  for (const typed of ["run", "runn", "runnin", "running"]) {
    const q = `${marker} ${typed}`;
    // The palette keeps the previous results until this query's response lands; assert only after it does.
    const landed = page.waitForResponse((r) => new URL(r.url()).searchParams.get("q") === q);
    await input.fill(q);
    await landed;
    await expect(palette, typed).toContainText(`${marker} running shoes`, { timeout: 1_000 });
  }
});

test("adversarial: the prefix never stands in for another term or a filter", async ({ request, marker, track }) => {
  const decoy = `zz${marker.split("").reverse().join("")}`;
  for (const data of [
    { title: `${marker} running shoes` },
    { title: `${decoy} running late` },
    { type: "quote", title: `${marker} quoted`, body: "better studies" },
  ]) {
    const res = await request.post("/api/cards", { data });
    expect(res.status()).toBe(201);
    track((await res.json()).card.id);
  }
  const titles = async (q: string, extra = "") => {
    const body: { hits: { title: string | null }[] } = await (
      await request.get(`/api/search?mode=hybrid&q=${encodeURIComponent(q)}${extra}`)
    ).json();
    return body.hits.map((h) => h.title);
  };
  // `runn` reaches "running" only through the unstemmed words; the marker must still match.
  const runn = await titles(`${marker} runn`);
  expect(runn).toContain(`${marker} running shoes`);
  expect(runn).not.toContain(`${decoy} running late`);
  expect(await titles(`${marker} zqxban runn`)).toEqual([]);
  expect(await titles(`${marker} -shoes runn`)).not.toContain(`${marker} running shoes`);
  expect(await titles(`${marker} studi`, "&type=quote")).toEqual([`${marker} quoted`]);
  expect(await titles(`${marker} runn`, "&type=quote")).toEqual([]);
});

test("adversarial: a punctuation-joined term matches as a prefix while typing", async ({ page, request, marker, track }) => {
  const res = await request.post("/api/cards", {
    data: { title: `${marker} stack`, body: "notes on node.js, example.com, user@mail.io and state-of-the-art" },
  });
  expect(res.status()).toBe(201);
  track((await res.json()).card.id);

  const titles = async (q: string) => {
    const body: { hits: { title: string | null }[] } = await (
      await request.get(`/api/search?mode=hybrid&q=${encodeURIComponent(q)}`)
    ).json();
    return body.hits.map((h) => h.title);
  };
  for (const typed of ["example.c", "node.j", "user@mail", "state-of"]) {
    expect(await titles(`${marker} ${typed}`), typed).toContain(`${marker} stack`);
  }

  const palette = page.getByRole("dialog", { name: "Search" });
  await pressUntilVisible(page, "/", palette);
  const q = `${marker} example.co`;
  const landed = page.waitForResponse((r) => new URL(r.url()).searchParams.get("q") === q);
  await page.getByRole("combobox", { name: "Search" }).fill(q);
  await landed;
  await expect(palette).toContainText(`${marker} stack`, { timeout: 1_000 });
});
