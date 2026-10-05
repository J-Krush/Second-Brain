# HTTP API

All routes live under `src/app/api/**/route.ts`, run on the `nodejs` runtime, and return JSON. Keep this page in sync with the handlers; the zod schemas in each route are the authority for request bodies.

## Authentication

Every route except `POST /api/auth/login` calls `authorize()`, which accepts either:

- the session cookie set by login (browser), or
- `Authorization: Bearer <token>` where the token is `API_TOKEN` (capture clients) or `CRON_SECRET` (the cron dispatcher).

Both bearer tokens grant the same access as a logged-in session. Unauthorized → `401 {"error":"unauthorized"}`; bad input → `400 {"error":"…"}`; missing → `404`.

Capturing from a script:

```sh
curl -X POST https://<your-worker>/api/cards \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"# A thought\nwith a body"}'
```

## Auth

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | `{ password }` | Rate-limited 5 attempts/min per IP (fixed window in `login_attempts`). Sets a sealed, httpOnly, 30-day rolling cookie |
| `POST` | `/api/auth/logout` | — | Clears the cookie |
| `POST` | `/api/auth/refresh` | — | Reseals the cookie when it is past the roll threshold; called by `SessionRefresh` on load |

## Cards

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/cards` | `{ type?, title?, body?, url?, props? }` | `type` defaults to `thought`; unknown types are rejected. To capture a link send `type: "link"` and `url` (the browser composer derives these from a leading URL; the API does not). Server stamps `props.source`, syncs inline file refs, then `after()` runs OG capture (links) and embedding. `201 { card }` |
| `GET` | `/api/cards` | `?view=inbox\|library&type=a,b&source=k1,k2&tag=1,2&order=asc\|desc&cursor=` | Keyset pagination on `(created_at, id)`; `nextCursor` is `"<iso>\|<uuid>"`. Filters are comma lists, OR within a key, AND across. Source keys: `typed`, `share`, `upload`, `book`, `web:<domain>` |
| `GET` | `/api/cards/count` | — | `{ inbox }` exact untriaged count |
| `GET` | `/api/cards/facets` | `?view=inbox\|library` | `{ kinds: [{type,count}], sources: [{key,label,via,domain,count}] }` scoped to the view only |
| `GET` | `/api/cards/:id` | — | `{ card, tags, files, boards, links, backlinks }` — boards it appears on, outgoing edges, incoming edges |
| `PATCH` | `/api/cards/:id` | `{ type?, title?, body?, url?, props?, triaged? }` | Partial. `triaged: true/false` sets/clears `triaged_at`. Re-syncs refs; re-embeds when `title`/`body` are present; re-captures OG for links when `url` or `type` are present |
| `DELETE` | `/api/cards/:id` | — | Soft delete (`deleted_at`); GC hard-deletes after 30 days |
| `POST` | `/api/cards/:id/tags` | `{ tagId, action: "attach"\|"detach" }` | Attaching auto-triages |

## Search

| Method | Path | Query | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/search` | `?q=&mode=quick\|fts\|semantic\|hybrid&type=&tag=&match=all\|any` | `{ mode, hits, degraded }`. Default `hybrid`. `semantic` → `503 {"error":"embeddings not configured"}` when no provider; `hybrid` silently falls back to FTS with `degraded: true`. `match=any` ORs the query's lexemes (fts/hybrid only); default requires every term |

## Ask

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/ask` | `{ question (1–2000 chars), type?, tag? }` | Streams `application/x-ndjson`, one `AskEvent` per line: first `{type:"sources", sources[], degraded, model}` (8 hits max, `match=any` hybrid; `model` is `null` when `LLM_PROVIDER` is unset), then `{type:"delta", text}`… and `{type:"done", citations[]}`, or `{type:"error", message}`. Each source has `index` (1-based, what the answer cites as `[n]`), `id`, `type`, `title`, `excerpt` (≤1500 chars, image embeds stripped), `url`, `createdAt`, `score`. Retrieval finishes before the response is committed; without a model, `done` follows `sources` immediately |

## Tags and edges

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/tags` | — | All tags with card counts |
| `POST` | `/api/tags` | `{ name (1–64), color? }` | |
| `PATCH` | `/api/tags/:id` | `{ name?, color? }` | Rename applies everywhere |
| `DELETE` | `/api/tags/:id` | — | Detaches from all cards |
| `POST` | `/api/edges` | `{ fromCard, toCard, label?, description? }` | Upsert. Omitting `description` leaves an existing one untouched (board arrow sync relies on this) |
| `DELETE` | `/api/edges` | `{ fromCard, toCard }` | |
| `GET` | `/api/edges/labels` | — | `{ labels }` distinct labels for the relation editor's datalist |

## Boards

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/boards/:id` | — | Board card + placements + the placed cards |
| `PATCH` | `/api/boards/:id` | `{ snapshot }` | Stores tldraw's non-card shapes (arrows, scribbles) in the board's `props` |
| `POST` | `/api/boards/:id/placements` | `{ cardId, x, y, w?, h?, z? }` | Places a card; auto-triages it |
| `PATCH` | `/api/boards/:id/placements/:cardId` | `{ x?, y?, w?, h?, z? }` | Move/resize |
| `DELETE` | `/api/boards/:id/placements/:cardId` | — | Removes from this board only; the card lives on |

## Files

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/files/presign` | `{ sha256, mime, bytes }` | `{ fileId, existing: true }` if an active file with that hash exists (skip the upload), else `{ fileId, existing: false, uploadUrl }` for a presigned PUT against a `pending` row |
| `POST` | `/api/files/:id/confirm` | — | Verifies the object, records dimensions, builds `thumb-400`/`thumb-1200` webp via Images, flips to `active` |
| `GET` | `/api/files/:id/:variant` | `variant ∈ original\|thumb-400\|thumb-1200` | 302 to a short-TTL presigned GET. Non-images fall back to `original` |

Client helper: `src/lib/upload-client.ts` does hash → presign → PUT → confirm.

## Share target and export

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/share` | `multipart/form-data` with `title`, `text`, `url`, `files[]` (images) — the PWA share-sheet target declared in `public/manifest.webmanifest`. Creates a card with `props.source.via = "share"`, ingests images, 303-redirects to it |
| `GET` | `/api/export` | Streams a zip: every card as markdown with YAML front-matter (id, type, title, tags, …) plus every referenced file |

## Maintenance

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`POST` | `/api/admin/gc` | Garbage collection; `GET` is what the Cron Trigger sends. Returns counts of what it removed |
| `GET`/`POST` | `/api/admin/embed-sweep` | Embed stale/unembedded cards in a batch |
| `POST` | `/api/admin/reconcile` | Diff bucket keys against `files.r2_prefix`; delete strays |

Schedules live in `wrangler.jsonc` → `triggers.crons` and are dispatched by `worker.ts`.
