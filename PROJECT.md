# Second Brain

A personal, self-owned knowledge base: part inbox, part library, part infinite canvas. Single user, private on the web, built to outlive any vendor.

## Vision

The core problem this solves: thoughts, quotes, links, ideas, rituals, and business plans get lost because there is never an obvious place to put them, and that friction stops capture entirely. This system's first promise is that there is always exactly one place to put things, and it is the same place every time.

The second promise is ownership. No subscriptions to a knowledge silo. The data lives in a Postgres database and an R2 bucket that I control, with an export path to plain markdown at all times.

The third promise is that it should be beautiful. Not a whiteboard tool, not a database UI. Spatial boards that feel alive, with images, texture, and care in the visual design.

## Core principles (do not violate these)

1. **Capture never requires a location.** Everything lands in the inbox as an unfiled card. Filing, tagging, and placing on boards are optional, later actions. Capture must take under two seconds.
2. **Everything is a card.** One universal entity with a `type` field. Thoughts, quotes, links, videos, documents, mantras, projects, and boards are all cards. Types add affordances, not new tables.
3. **Membership is many-to-many.** A card never lives "in" a board. It appears on any number of boards via placements. The card is the source of truth; boards hold references plus positions. Editing a card updates it everywhere.
4. **Graph vs list is a false choice.** The store is cards and links. The UI renders it through multiple views: inbox (chronological stream), library (filterable list), boards (curated spatial canvases), and optionally a derived graph view (lowest priority, possibly never).
5. **Boards are cards** (`type='board'`), so nesting is free: a project card contains boards, boards contain cards, any card on a board can itself be a board. Depth limits are a rendering concern, not a data concern.
6. **No `parent_id` on cards.** Hierarchy lives entirely in placements. A card can genuinely exist in multiple places. This absence is intentional; do not add it back.
7. **Own the bytes.** Images are stored in R2, not hotlinked. Link previews are fetched and cached at capture time so boards never rot. An "export everything to markdown + files" function is a hard requirement, not a nice-to-have.

## Decisions log (with rationale)

- **Web app, not native Swift.** The board view is the soul of the product and tldraw provides years of canvas engineering for free; there is no Swift equivalent. Multi-device access requires web anyway. A tiny Swift menu-bar capture utility (global hotkey, POST to API, vanish) is a planned add-on, not the app.
- **Postgres over SQLite.** Multi-device from day one, `tsvector` full-text search, `pg_trgm` fuzzy matching, recursive CTEs for walking board hierarchies, and pgvector for semantic search, all in one system with no extra services. Hosted on Neon (free tier, standard `pg_dump` escape hatch preserves the ownership rule).
- **Postgres over MongoDB.** The data is relational and graph-shaped: many-to-many card/board membership, card-to-card edges, cross-cutting tags. Document stores handle this shape worst (embed-vs-reference dilemma on every relation). Schema flexibility for card types comes from a JSONB `props` column instead.
- **Postgres over Convex.** Convex's strength is real-time multiplayer reactivity, which a single-user knowledge base barely uses. This app leans on exactly what SQL is best at: tunable search, ranked FTS, recursive queries, vector search. Multi-device "sync" for one person is fetch-on-load; if live updates are ever needed, LISTEN/NOTIFY or a small websocket layer can be added later.
- **R2 for files, accessed only via the S3 API.** Writing against the S3 API keeps the backend swappable (MinIO on the NAS, etc.), which is the no-lock-in principle expressed in code. R2 has zero egress fees and a 10GB free tier.
- **Semantic search from day one.** pgvector columns and the embedding pipeline are part of v1, not a later retrofit.
- **The auto-generated global graph view is deprioritized.** Curated boards are where thinking happens; spaghetti graphs are decorative. Build boards early, graph view last or never.

## Stack

- **Frontend:** Next.js (App Router) + React + Tailwind. tldraw SDK for the board/canvas view. PWA manifest + share target so mobile capture works from the share sheet.
- **Backend:** Next.js API routes (or route handlers). Single deployable.
- **Database:** Neon Postgres with `pgvector` and `pg_trgm` extensions, reached from the Worker through Hyperdrive (caching disabled).
- **File storage:** Cloudflare R2 via the S3 API, presigned URLs for upload and read. Bucket is private.
- **Image processing:** Cloudflare Images binding (`IMAGES`), run server-side after upload confirmation (dimensions + webp thumbnail variants).
- **Embeddings:** Workers AI `@cf/baai/bge-m3` (1024 dims) via the `AI` binding in the Worker (REST fallback for local dev when `CF_*` vars are set). Keep the embedding call behind a single module so the provider is swappable; the column dimension is fixed at 1024, so a provider change that alters dimensions requires a migration and re-embed (acceptable).
- **Hosting:** Cloudflare Workers via `@opennextjs/cloudflare`. Nightly GC and hourly embed sweep run as Cron Triggers (`worker.ts`).

## Auth (single user, private)

Simplest thing that is actually secure:

- `APP_PASSWORD_HASH` env var containing a PBKDF2-SHA256 hash of my password (WebCrypto; `pnpm hash-password`). No users table needed.
- `/login` page posts the password; on success, set a signed, httpOnly, secure session cookie (30-day expiry, rolling). Use `iron-session` or equivalent.
- Every page (via `requireSession()` in the layout and each page) and every API route (via `authorize()`) checks the session; only `/login` and the login endpoint are public. There is no Next proxy/middleware (OpenNext Cloudflare does not run it). All R2 access goes through presigned URLs generated by authenticated API routes; the bucket itself is never public.
- Rate-limit the login endpoint (e.g. 5 attempts/minute) to make brute force impractical.
- Capture endpoints (menu-bar app, share target) authenticate with the same session cookie, or a long-lived API token stored in an `API_TOKEN` env var checked via bearer header for non-browser clients.

## Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The universal entity
CREATE TABLE cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,            -- 'thought','quote','link','video','document','project','board','mantra'
  title       TEXT,
  body        TEXT,                     -- markdown
  url         TEXT,                     -- for link/video cards
  props       JSONB NOT NULL DEFAULT '{}',  -- type-specific fields (e.g. tldraw snapshot for boards, og metadata for links)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,              -- soft delete; GC hard-deletes after 30 days

  -- Full-text search
  search      TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,'')),  'B')
  ) STORED,

  -- Semantic search
  embedding      VECTOR(1024),          -- null until embedded
  embedding_hash TEXT,                  -- sha256 of (title || body) at embed time; staleness check
  embedded_at    TIMESTAMPTZ
);

CREATE INDEX cards_search_idx    ON cards USING GIN (search);
CREATE INDEX cards_title_trgm    ON cards USING GIN (title gin_trgm_ops);
CREATE INDEX cards_type_idx      ON cards (type) WHERE deleted_at IS NULL;
CREATE INDEX cards_inbox_idx     ON cards (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX cards_embedding_idx ON cards USING hnsw (embedding vector_cosine_ops);

-- Explicit links between cards
CREATE TABLE edges (
  from_card  UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_card    UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_card, to_card)
);

-- Spatial membership: a card's position on a board
CREATE TABLE placements (
  board_id   UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  card_id    UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  w DOUBLE PRECISION,
  h DOUBLE PRECISION,
  z INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, card_id)
);
CREATE INDEX placements_card_idx ON placements (card_id);  -- "which boards is this card on?"

-- Tags
CREATE TABLE tags (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE card_tags (
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_id  INT  NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

-- Files stored in R2
CREATE TABLE files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_prefix  TEXT NOT NULL,             -- 'files/{id}/' ; original + variants live under it
  mime       TEXT NOT NULL,
  bytes      BIGINT NOT NULL,
  width      INT,
  height     INT,
  sha256     TEXT NOT NULL UNIQUE,      -- dedupe: re-upload of identical bytes reuses the row
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference ledger: who uses a file (drives garbage collection)
CREATE TABLE file_refs (
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  role    TEXT NOT NULL,                -- 'attachment' | 'inline' | 'cover' | 'og_cache'
  PRIMARY KEY (file_id, card_id, role)
);
```

## File lifecycle (R2 + DB stay in sync)

R2 key layout: `files/{file_id}/original.{ext}`, `files/{file_id}/thumb-400.webp`, `files/{file_id}/thumb-1200.webp`. Deleting a file is a single delete-by-prefix; new variant sizes need no schema change.

1. **Upload:** client requests a presigned PUT from the API. The API first checks `sha256` (client computes and sends it): if a matching `active` file exists, skip upload and just return the existing file id. Otherwise insert a `files` row with `status='pending'`, return the presigned URL. Client PUTs to R2, then calls a confirm endpoint. Server verifies the object exists, generates thumbnails with the Images binding, uploads variants, flips status to `active`.
2. **Reference tracking:** `file_refs` is derived server-side on every card save. Markdown embeds files by id (`![](file:UUID)`); the save handler parses the body and syncs `inline` refs to match. Attachments, covers, and cached OG images get explicit refs. Never trust the client to report references.
3. **GC job** (nightly cron; also expose a manual "clean up now" admin action):
   - `pending` files older than 24h: delete R2 prefix, delete row.
   - `active` files with zero `file_refs` rows: same.
   - Cards with `deleted_at` older than 30 days: hard DELETE (cascades placements, edges, tags, refs; newly orphaned files are caught on the next pass or in the same run by ordering card deletion first).
4. **Reconciliation** (monthly or on demand): list all R2 keys, diff against `files.r2_prefix`. Keys the DB does not know about are strays from bugs or crashed uploads: log and delete.

## Link capture

When a card of type `link` is saved: server-side fetch of the URL, parse OpenGraph/meta (title, description, image), download the OG image into R2 as a file with role `og_cache`, store metadata in `props`. Boards must never depend on remote images that can rot.

## Search (three layers, one search box)

1. **Quick switcher (as-you-type):** `pg_trgm` similarity on `title` for typo-tolerant instant matches.
2. **Full-text:** `websearch_to_tsquery` against the generated `search` column, ranked with `ts_rank`, title hits weighted above body hits. Filterable by tag and type.
3. **Semantic:** cosine similarity over `embedding` for "what were those thoughts about presence" style queries.

**Hybrid results:** run FTS and vector queries in parallel, merge with reciprocal rank fusion (score = sum of 1/(60 + rank) across both lists), return the fused ranking. Expose a toggle in the UI to see each mode alone while tuning.

**Embedding pipeline:** on card create/update, compute sha256 of `(title || body)`. If it differs from `embedding_hash`, mark stale and enqueue an embed (a simple in-process queue or a cron sweep of stale cards is fine; no job infrastructure needed). Embed `title + "\n\n" + body`, truncated to the model's token limit. Cards with empty text keep a null embedding and are excluded from vector search. If a document card's body grows very long, chunking into a separate `card_chunks` table is a v2 concern; do not build it yet.

## API surface (v1)

```
POST   /api/auth/login          { password } -> session cookie
POST   /api/auth/logout

POST   /api/cards               create (capture endpoint; body optional, type defaults to 'thought')
GET    /api/cards?view=inbox|library&type=&tag=&q=&cursor=
GET    /api/cards/:id           card + tags + boards-it-appears-on + backlinks
PATCH  /api/cards/:id           partial update (triggers ref sync + embed staleness)
DELETE /api/cards/:id           soft delete

GET    /api/search?q=&mode=hybrid|fts|semantic|quick

POST   /api/boards/:id/placements      add card to board at x,y
PATCH  /api/boards/:id/placements/:cardId
DELETE /api/boards/:id/placements/:cardId
GET    /api/boards/:id                  board card + placements + placed cards

POST   /api/tags                and standard CRUD; PATCH renames globally
POST   /api/cards/:id/tags      attach/detach

POST   /api/files/presign       { sha256, mime, bytes } -> existing file OR presigned URL + pending id
POST   /api/files/:id/confirm   verify, thumbnail, activate
GET    /api/files/:id/:variant  redirect to presigned GET (short TTL)

POST   /api/admin/gc            manual garbage collection
GET    /api/export              zip: all cards as markdown + files (the escape hatch)
```

Non-browser capture clients (menu-bar app, iOS shortcut) authenticate with `Authorization: Bearer ${API_TOKEN}`.

## UI views (priority order)

1. **Inbox:** reverse-chronological stream of all cards. The default landing view. Inline quick-capture box at the top of the stream, under the header. Keyboard-first: `⌘J` to capture, `⌘K` (or `/`) to search.
2. **Library:** table/list with tag filters, type filters, and the search box. Dense, fast.
3. **Card view:** markdown editor, tags, attachments, backlinks ("appears on boards: ...", "linked from: ...").
4. **Boards (tldraw):** custom card shapes rendering real card content (thumbnail images, quote styling per type). Placement changes persist to `placements`; tldraw-native scribbles/arrows persist as a snapshot in the board card's `props`. Double-click a board-type card to drill in; breadcrumb trail to navigate back up.
5. **Graph view:** derived from `edges`. Last priority; skip until everything else is loved.

Visual bar: this should feel like a crafted personal space, not an admin panel. Card types get distinct visual treatments (quotes look like quotes, mantras feel ceremonial, links show their cached preview image). Dark mode first.

## Build order

1. Repo scaffold, Neon + R2 setup, auth middleware, schema migration.
2. Capture endpoint + inbox view + card view. (The system is already useful here.)
3. Tags + library view + FTS/quick search.
4. File upload pipeline + image rendering + link OG capture.
5. Embedding pipeline + hybrid search.
6. Boards with tldraw + placements + nesting.
7. GC job + reconciliation + markdown export.
8. PWA share target; Swift menu-bar capture app (separate mini-project).

## Environment variables

```
DATABASE_URL=            # local dev, scripts, migrations (prod uses the HYPERDRIVE binding)
APP_PASSWORD_HASH=       # PBKDF2 hash from `pnpm hash-password`
SESSION_SECRET=          # 32+ random bytes for cookie signing
API_TOKEN=               # long random token for non-browser capture clients
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=             # optional S3 endpoint override (MinIO locally)
CF_ACCOUNT_ID=           # optional, local dev only: Workers AI via REST
CF_AI_TOKEN=             # optional, local dev only; empty = FTS-only search
CRON_SECRET=             # bearer the Cron Trigger sends to /api/admin/*
```

In production, non-secret values live in `wrangler.jsonc` `vars`; secrets are
GitHub repo secrets that the deploy workflow uploads with every deploy
(rotate with `gh secret set NAME`, then rerun the workflow). `.dev.vars`
mirrors `.env.local` for `pnpm preview`. `pnpm cf` is wrangler with
a project-local login (`.cf-auth/`), separate from any global wrangler login.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`): every PR runs typecheck +
tests; every push to `main` runs them again, then `pnpm db:migrate` against
Neon, then builds and deploys the Worker. Migrations run before the new code
is live, so keep them backward compatible with the deployed version.
Repo secrets: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL` (Neon direct URL), plus
the Worker secrets above (`APP_PASSWORD_HASH`, `SESSION_SECRET`, `API_TOKEN`,
`CRON_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). The
Cloudflare account is pinned by `account_id` in `wrangler.jsonc`.

## Non-goals (v1)

- Multi-user anything (sharing, collaboration, presence)
- Real-time sync between simultaneously open devices (last-write-wins is fine)
- The global graph view
- Mobile-optimized board editing (mobile is for capture and reading)
- Chunked embeddings for long documents
