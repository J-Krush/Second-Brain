# Local development

Two local services stand in for production: Postgres (pgvector) for Neon, MinIO for R2. The app code is identical — it only ever speaks SQL and S3. Workers AI, Images, and Hyperdrive are Cloudflare-only; the dev loop degrades gracefully without them (see *What works without Cloudflare*).

## Prerequisites

- Node 22 (what CI uses; there is no `.nvmrc`)
- pnpm 11 (CI uses `pnpm/action-setup@v4` with `version: 11`)
- Docker (Desktop or compatible)

## Setup

```sh
pnpm install
docker compose up -d          # secondbrain-pg on :55432, secondbrain-minio on :9000 (console :9001)
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Value for local dev |
| --- | --- |
| `DATABASE_URL` | Leave as in the example (`postgres://postgres:postgres@localhost:55432/secondbrain`) |
| `APP_PASSWORD_HASH` | Output of `pnpm hash-password "your password"`. Format is `pbkdf2-sha256:<iter>:<salt>:<hash>` — colons on purpose, so nothing needs escaping in dotenv |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `API_TOKEN` | Any long random string; used by non-browser capture clients (`Authorization: Bearer …`) |
| `CRON_SECRET` | Any long random string; lets you call `/api/admin/*` by hand |
| `R2_*` | Leave the MinIO defaults from the example (`minioadmin`/`minioadmin`, bucket `secondbrain-dev`, endpoint `http://localhost:9000`). `docker compose` creates the bucket |
| `CF_ACCOUNT_ID`, `CF_AI_TOKEN` | Optional. Set them to get real embeddings in dev via the Workers AI REST API; create the token in the Cloudflare dashboard under Workers AI → *Use REST API* |
| — | `/ask` needs no extra env: the model and every knob are chosen on `/settings`. Without `CF_*` an answer fails with `CF_ACCOUNT_ID / CF_AI_TOKEN not set` shown in the thread; set the provider to *Off* for a retrieval-only preview |

Then:

```sh
pnpm db:migrate     # applies src/db/*.sql in order, records them in _migrations
pnpm dev            # http://localhost:3001
```

Log in at `/login`. `⌘J` to capture, `⌘K` to search.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | `next dev` on :3001 with OpenNext's dev shim (`initOpenNextCloudflareForDev`, remote bindings off) |
| `pnpm typecheck` | `tsc --noEmit` for the app **and** `tsc -p tsconfig.worker.json` for `worker.ts` (different `lib` set; both must pass) |
| `pnpm test` | `vitest run` — pure unit tests (`src/lib/*.test.ts`), no DB |
| `pnpm db:migrate` | `scripts/migrate.ts` against `DATABASE_URL` (reads `.env.local` then `.env`) |
| `pnpm hash-password "…"` | Prints an `APP_PASSWORD_HASH` |
| `pnpm preview` | Builds with `opennextjs-cloudflare` and runs the real Worker locally under `wrangler`, reading `.dev.vars`. Closest thing to production; use it before touching `worker.ts`, bindings, or anything edge-specific |
| `pnpm cf …` | `wrangler` with a project-local login (`.cf-auth/`, git-ignored), isolated from any global wrangler session |
| `pnpm cf:types` | Regenerates `cloudflare-env.d.ts` from `wrangler.jsonc` after changing bindings |

`.dev.vars` mirrors `.env.local` for `pnpm preview` (same keys; git-ignored). `wrangler.jsonc` points Hyperdrive's `localConnectionString` at the compose Postgres, so preview hits the same database as `pnpm dev`.

## What works without Cloudflare

| Feature | Local behaviour |
| --- | --- |
| Capture, inbox, library, filters, tags, edges, boards, export, GC, reconcile | Fully working against Docker |
| File upload + thumbnails | Works. MinIO takes the bytes; wrangler's platform proxy emulates the `IMAGES` binding locally, so dimensions and webp variants are generated in dev too |
| Link OpenGraph capture | Works (plain `fetch`) |
| Semantic / hybrid search | Needs embeddings. Without `CF_AI_TOKEN`, cards are not embedded, `mode=semantic` returns 503, and `hybrid` returns `degraded: true` with FTS-only results. The UI shows an amber note |
| Ask | Retrieval works (FTS-only without embeddings). An answer needs Workers AI: in dev that's `CF_ACCOUNT_ID` + `CF_AI_TOKEN`; in prod the `AI` binding. Provider *Off* on `/settings` makes the page a retrieval preview |
| Cron triggers | Not scheduled locally. Call the routes by hand: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3001/api/admin/gc`, or use the buttons on `/settings` |

## Database

- Migrations are plain SQL in `src/db/NNNN_name.sql`, applied alphabetically, each inside a transaction, recorded in `_migrations(name, applied_at)`. Re-running `pnpm db:migrate` is idempotent.
- To add one: create the next number, write backward-compatible SQL (CI runs migrations **before** deploying the new code, so the old Worker runs against the new schema for a few seconds), then mirror any column changes in `src/db/schema.ts`.
- Reset: `docker compose down -v && docker compose up -d && pnpm db:migrate`.
- Poke at it: `docker exec -it secondbrain-pg psql -U postgres -d secondbrain`.

## MinIO

Console at <http://localhost:9001> (`minioadmin` / `minioadmin`). The app uses path-style S3 URLs so presigned links work against `localhost:9000`. If you blow the volume away, `docker compose up -d` recreates the bucket through the one-shot `minio-init` service.

## Verifying a change

`pnpm typecheck && pnpm test` is the CI gate and should be green before a PR. It is not sufficient: the test suite is small and pure, so **exercise the changed surface in the running app** (browser, `curl`, or `psql`) and say what you ran in the PR description. See [`conventions.md`](conventions.md#verification).

## Gotchas collected so far

- **Port 3001**, not 3000, to stay out of the way of other Next apps on the same machine.
- `AGENTS.md` starts with a block that `next dev` regenerates. It is committed verbatim so the tree stays clean; if a Next upgrade rewrites it, commit the new block with your change rather than fighting it. `CLAUDE.md` is just `@AGENTS.md`.
- `next dev` runs with `remoteBindings: false`: the `AI` binding is a stub that throws. Code must probe for a working binding rather than assume one (see `aiBinding()` in `src/lib/workers-ai.ts`); `IMAGES` and `HYPERDRIVE` are emulated locally.
- The DB client is a `Proxy` that resolves a pool per request context. Never cache a `db` reference across requests or in module scope; import `{ db }` and use it inside the handler.
- `⌘N` is reserved by every browser, which is why capture is `⌘J`.
- Sessions are stateless (sealed cookie, no table), so resetting the database does not log you out and changing `SESSION_SECRET` logs everyone out.
