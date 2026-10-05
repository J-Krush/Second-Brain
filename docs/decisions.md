# Decisions and findings

A running log of the choices that shape the codebase and the things we learned the hard way. Newest at the bottom of each section. When you change something foundational, add an entry — one paragraph: what, why, what it cost. The product-level rationale (Postgres over SQLite/Mongo/Convex, boards as cards, no `parent_id`, own the bytes) lives in [`../PROJECT.md`](../PROJECT.md#decisions-log-with-rationale) and is not repeated here.

## Platform

### D1 · Cloudflare Workers instead of Vercel

v1 (PR #1) shipped for Vercel with Vercel crons and OpenAI embeddings. It was moved to a single Cloudflare Worker via `@opennextjs/cloudflare` so that the database pooler (Hyperdrive), object storage (R2), image processing (Images), embeddings (Workers AI), and scheduling (Cron Triggers) all come from one account with no third-party keys and no egress fees. Cost: a handful of platform constraints that leak into the code, each recorded below.

### D2 · Embeddings are Workers AI `@cf/baai/bge-m3`, 1024 dims (migration `0001`)

Replaced OpenAI `text-embedding-3-small` (1536). bge-m3 is multilingual, accepts 8192 tokens, is free at this scale, and needs no secret in the deployed Worker (the `AI` binding). The vector column dimension is fixed, so the migration dropped the HNSW index, altered the column to `VECTOR(1024)` with `USING NULL`, cleared `embedding_hash`/`embedded_at`, and rebuilt the index; the hourly sweep re-embedded everything. The provider stays behind one module (`src/lib/embeddings.ts`) — changing it again means another migration + re-embed, which is an acceptable cost.

### D3 · No middleware; auth is explicit per page and per route

OpenNext on Workers does not run Next's `proxy.ts`/`middleware.ts`, so the v1 auth guard was removed. Every page calls `requireSession()` (`src/lib/page-auth.ts`) and every API handler calls `authorize()` (`src/lib/route-helpers.ts`). Adding a page or route without one of those makes it public — review for it.

### D4 · One database pool per request context

Workers forbid using a socket opened by one request from another ("Cannot perform I/O on behalf of a different request"), so a module-level `pg.Pool` crashed on the second hit. `src/db/index.ts` keys a small pool on the OpenNext `ExecutionContext` in a `WeakMap` and exposes `db` as a `Proxy` so call sites keep `import { db }`. Hyperdrive makes the per-request connect cheap. Under `next dev` the context is a single object, which collapses to one pool.

### D5 · Hyperdrive with caching disabled

Hyperdrive caches reads for 60s by default; for a capture tool that would hide a just-saved card on the next load. The Hyperdrive config is created with `--caching-disabled` and must stay that way.

### D6 · PBKDF2 (WebCrypto) instead of argon2

v1 used `@node-rs/argon2`, a native module that cannot run in Workers. The hash is now PBKDF2-SHA256 via WebCrypto (`src/lib/password.ts`), 100k iterations. Side effect worth keeping: the stored format is `pbkdf2-sha256:<iter>:<salt>:<hash>` with colons rather than `$`, because `$` in dotenv files gets expanded by Next and bit us in v1.

### D7 · Cloudflare Images instead of sharp

sharp is native and unavailable in Workers. Thumbnails (`thumb-400`, `thumb-1200` webp) and dimensions come from the `IMAGES` binding after upload confirmation. The R2 key layout (`files/{id}/original.ext`, `files/{id}/thumb-N.webp`) did not change, so new variant sizes still need no schema change.

### D8 · Background work via `after()`, failures caught by cron

Link OpenGraph capture and embedding run in Next's `after()` so capture responds immediately. There is no queue; if an `after()` dies, the hourly `embed-sweep` and the staleness hash catch embeddings, and a link without `props.og` simply re-renders without a preview. Good enough for one user; revisit if capture volume ever makes the sweep lag noticeable.

### D9 · Secrets ship from GitHub on every deploy

Rather than `wrangler secret put` by hand, the workflow writes a `--secrets-file` from repo secrets at deploy time. "What is deployed" is answerable from GitHub alone, a fresh Worker works on its first deploy, and rotation is `gh secret set` + re-run. Non-secret config lives in `wrangler.jsonc` `vars`.

### D10 · Migrations are raw SQL, applied by CI before the deploy

`src/db/*.sql` is the source of truth; `src/db/schema.ts` (Drizzle) mirrors it for typed queries. `scripts/migrate.ts` applies files alphabetically in transactions and records them in `_migrations`. The workflow migrates then deploys, so every migration must be compatible with the previous Worker for the seconds in between — additive first, destructive later.

## Product and UI

### D11 · Everything on one page, with state in the URL

Inbox and library are the same `/` page (`?scope=`), as a timeline or desk (`?view=`), with the card modal (`?card=`) and all filters (`?type=`, `?source=`, `?tag=`, comma lists) in the query string. `window.history.replaceState` keeps filter changes out of the back stack; opening a card pushes so the back button closes it. `/library` and `/cards/:id` redirect in. Result: every view is a shareable, reload-safe link and there is one data-fetching component (`BrainPage`).

### D12 · Triage is a timestamp, not a folder (migration `0002`)

The inbox is `triaged_at IS NULL`. Tagging a card, placing it on a board, or creating a board auto-triages; `e` in the modal archives explicitly. The backfill treated anything already tagged/placed/a board as triaged. This keeps "capture never requires a location" true while giving the inbox a way to empty.

### D13 · Provenance lives in `props.source` and is filterable in SQL (migration `0003`)

`sourceOf()` (`src/lib/source.ts`) resolves a card's origin — `typed`, `web` (+ domain), `share`, `upload`, `book` (+ author/work/page). It started as a display-only derivation; making source a real library filter required it to be queryable, so `0003` backfilled `props.source` for every existing card (domain from URL, else typed) and `createCard` stamps it going forward. Facet keys are `web:<domain>` or the bare channel.

### D14 · Capture is a `⌘J` dialog, not an inline form

The first header iteration kept a composer at the top of the stream; it dominated the page. Capture now lives in a centered overlay identical to the `⌘K` search palette, with a kind picker in its footer (so boards, projects, and mantras no longer need a separate typed form). Board canvases reuse the same dialog via `openCapture({ onCreated })`. `⌘N` was the obvious key and is reserved by every browser, hence `⌘J`.

### D15 · One filter control, multi-select, OR within / AND across

The library briefly had two filter systems (a kind-pill row and a source shelf inside the Desk). They were replaced by a single `FacetMenu` used for kind, source, and tag, with counts from `GET /api/cards/facets` (scoped to inbox/library, not to the other active filters, so counts never collapse to the current selection). Values within one menu are OR'd; menus are AND'd. The same component in single mode is the composer's kind picker, so every "choose from N" surface reads the same.

### D16 · Overlays are portaled to `document.body`

The header uses `backdrop-blur`, which creates a containing block that clips `position: fixed` children. Search and capture overlays render through `createPortal` to escape it. Keep doing this for any new overlay.

### D17 · Link cards open the modal; the external hop is explicit

Clicking anywhere on a link card used to leave the site. Now the card body opens the detail modal like every other kind; only the small `domain ↗` line (and the URL inside the modal) go external. Consistency beats one saved click.

### D20 · `/ask` is retrieval first, model second

The pipeline (hybrid retrieval → numbered passages → citations) is fixed in `src/lib/ask.ts`; the model is an `LlmProvider` behind `src/lib/llm.ts` chosen by `LLM_PROVIDER`, and nothing else in the app imports a vendor SDK. Consequences: the page is useful with no model at all (it shows what a model would read, which is also how you debug retrieval), swapping vendors is one registry entry, and the UI contract (NDJSON `sources` → `delta` → `done`) never changes. Finding along the way: `websearch_to_tsquery` ANDs terms, so a question like "what do I know about Hyperdrive" returned nothing because no card contains "know"; retrieval uses `match: "any"` (lexemes ORed, `ts_rank` orders by how many hit) while the search box keeps AND semantics.

## Testing and tooling

### D18 · Small pure test suite, mandatory manual smoke

vitest covers pure logic with real edge cases (RRF fusion, provenance resolution, facet-key round-trips). There are no DB or browser tests; the cost/benefit at single-user scale is poor. The rule that replaces them: every PR states what was exercised in the running app. See [`conventions.md`](conventions.md#verification).

### D19 · No linter or formatter

Strict TypeScript (`strict`, `noUncheckedIndexedAccess`) plus `tsc` on both tsconfigs is the gate. Formatting is by hand to the existing style; adding Prettier/ESLint is fine if someone wants to own the config and the initial reformat as its own PR.
