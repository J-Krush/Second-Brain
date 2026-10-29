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
- An inflected word matches at every prefix length, not only up to its stem: `run`, `runn`, `runnin` and `running` all find "running shoes" (was finding F6: the index holds the stem `run`, and `runn:*` does not reach it, so the prefix is also matched against the unstemmed words).

## Adversarial

- `Esc` closes the palette; `/` typed inside a text field does not open it.
- Typing quickly: results belong to the final query, never to an earlier one (requests are aborted). This holds when the final request fails too: a long pasted query (2000 CJK characters, 431 from the server) must not leave the previous query's results listed and selectable with `↵` (was finding F4).
- Empty query shows no error.
- Every word must match (`docs/api.md`: the default `match=all` requires every term; only the last word may be a prefix while typing). `<marker> zqxbanana` lists nothing, and `<marker> -thought` excludes `<marker> thought` (was finding F3: the first F1 fix fused the trigram matcher, which let `neon docs` list "Water filter comparison notes").
- A whole term with inner punctuation matches wherever it sits in the query: `<marker> node.js`, `<marker> example.com` and `<marker> v1.2` find a card containing those terms, just as `node.js <marker>` does (was finding F5: the prefix rewrite split the trailing `js`/`com`/`2` off the token).
- A term joined by punctuation still matches as a prefix while it is being typed, like a plain word does (§4): `<marker> example.c`, `<marker> node.j`, `<marker> user@mail` and `<marker> state-of` find a card containing `example.com`, `node.js`, `user@mail.io` and `state-of-the-art`, instead of flipping from results (`<marker> example`) to "no matches" and back (`<marker> example.com`) (was finding F7: the parser cannot prefix-match a partial joined token, so the last chunk also matches as the start of a word in the raw title or body).
- The typed last chunk is literal text matched at the start of a word, case-insensitively: `<marker> f(`, `<marker> a[1`, `<marker> back\` and `<marker> ZÜR` find a card containing `f(x)`, `a[1]`, `back\slash` and `Zürich`, while regex syntax is never a pattern (`r*`, `r.n`, `[rs]unn`, `zz|running` do not find "running shoes") and a fragment from inside a word is no prefix (`unning`, `hoes`, `ürich`).
