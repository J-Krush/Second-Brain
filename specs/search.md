# Search

The `⌘K` / `/` palette. It calls `GET /api/search?mode=hybrid`. Without an embedding provider (local dev without `CF_AI_TOKEN`), hybrid degrades to full-text search and the palette shows an amber `semantic index unavailable — text only` note.

**Seed:** `tests/seed.spec.ts`. Preconditions: a card titled `<marker> thought` with body `body line for uat` exists.

## 1. Find a card by a whole word

**Steps:**
1. Press `/` (or `⌘K`).
2. Type the full marker.

**Expected:**
- The palette opens with the input focused.
- The card is listed with its kind glyph, title, and relative age.
- With no embeddings, the amber degraded note is shown.

## 2. Find by body text

**Steps:**
1. Search `body line`.

**Expected:**
- The card is found by its body, not just its title.

## 3. Open a result

**Steps:**
1. With results showing, press `↵`.

**Expected:**
- The palette closes and the card modal opens; the URL gains `?card=<id>`.

## 4. Find while typing (prefix)

**Steps:**
1. Type the first few characters of a title word, e.g. `shar` for "share sheet".

**Expected:**
- Results appear for a word prefix (`shar` finds "share sheet"), not "no matches". With the default `match=all`, the last word of the query also matches as a prefix (FTS alone only matches whole lexemes; was finding F1).

## Adversarial

- `Esc` closes the palette; `/` typed inside a text field does not open it.
- Typing quickly: results belong to the final query, never to an earlier one (requests are aborted). This holds when the final request fails too: a long pasted query (2000 CJK characters, 431 from the server) must not leave the previous query's results listed and selectable with `↵` (was finding F4).
- Empty query shows no error.
- Every word must match (`docs/api.md`: the default `match=all` requires every term; only the last word may be a prefix while typing). `<marker> zqxbanana` lists nothing, and `<marker> -thought` excludes `<marker> thought` (was finding F3: the first F1 fix fused the trigram matcher, which let `neon docs` list "Water filter comparison notes").
