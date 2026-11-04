# HTTP API

All routes live under `src/app/api/**/route.ts`, run on the `nodejs` runtime, and return JSON. Keep this page in sync with the handlers; the zod schemas in each route are the authority for request bodies.

## Authentication

Every route except `POST /api/auth/login` calls `authorize()`, which accepts either:

- the session cookie set by login (browser), or
- `Authorization: Bearer <token>` where the token is `API_TOKEN` (capture clients) or `CRON_SECRET` (the cron dispatcher), or
- `Authorization: Bearer <CAPTURE_TOKEN>` on `POST /api/cards` and `POST /api/share` only.

`API_TOKEN` and `CRON_SECRET` grant the same access as a logged-in session. `CAPTURE_TOKEN` is create-only — it lives on a phone (the iOS Shortcut, see [`ingestion.md`](ingestion.md)) and gets `401` everywhere else. Unauthorized → `401 {"error":"unauthorized"}`; bad input → `400 {"error":"…"}`; missing → `404`.

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
| `POST` | `/api/cards` | `{ type?, title?, body?, url?, props? }` | Accepts `CAPTURE_TOKEN`. `type` defaults to `thought`; unknown types are rejected. To capture a link send `type: "link"` and `url` (the browser composer derives these from a leading URL; the API does not). `url` is canonicalised (tracking params and fragment dropped, YouTube forms unified; same on `PATCH`). Server stamps `props.source`, syncs inline file refs, then `after()` runs OG capture (links and videos) and embedding. `201 { card }` |
| `GET` | `/api/cards` | `?view=inbox\|library&type=a,b&source=k1,k2&tag=1,2&order=asc\|desc&cursor=` | Keyset pagination on `(created_at, id)`; `nextCursor` is `"<iso>\|<uuid>"`. Filters are comma lists, OR within a key, AND across. Source keys: `typed`, `share`, `upload`, `book`, `web:<domain>` |
| `GET` | `/api/cards/count` | — | `{ inbox }` exact untriaged count |
| `GET` | `/api/cards/facets` | `?view=inbox\|library` | `{ kinds: [{type,count}], sources: [{key,label,via,domain,count}] }` scoped to the view only |
| `GET` | `/api/cards/:id` | — | `{ card, tags, files, boards, links, backlinks, transcript }` — boards it appears on, outgoing edges, incoming edges, and the transcript (`null`, or `{ status, source, fileId, language, model, totalChunks, error, updatedAt, chunks: [{ seq, startMs, endMs, text }] }`) |
| `PATCH` | `/api/cards/:id` | `{ type?, title?, body?, url?, props?, triaged? }` | Partial. `triaged: true/false` sets/clears `triaged_at`. Re-syncs refs; re-embeds when `title`/`body` are present; re-captures OG for links and videos when `url` or `type` are present |
| `DELETE` | `/api/cards/:id` | — | Soft delete (`deleted_at`); GC hard-deletes after 30 days |
| `POST` | `/api/cards/:id/tags` | `{ tagId, action: "attach"\|"detach" }` | Attaching auto-triages |

## Transcripts

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/cards/:id/transcribe` | `{ source: "youtube" }` | Card `url` must be a YouTube URL, else 400. Clears existing chunks, sets `pending`, fetches captions in `after()`. `202 { transcript }`; poll `GET /api/cards/:id` until `status` is `done`, `unavailable`, or `failed` |
| `POST` | `/api/cards/:id/transcribe` | `{ source: "upload", fileId, totalChunks (1–900) }` | File must be active, referenced by this card, and `audio/*` or `video/*`, else 400. Clears existing chunks, sets `running`. `200 { transcript }` |
| `PUT` | `/api/cards/:id/transcribe/:seq` | raw 16 kHz mono WAV; headers `x-start-ms`, `x-end-ms` | Transcribes one chunk with whisper, stores and embeds it. `200 { seq, text, done }`. `409` unless the transcript is a running upload; `413` over 12 MB; `502 { error }` when whisper fails (retry the same seq) |
| `DELETE` | `/api/cards/:id/transcribe` | — | Removes the transcript and its chunks |

Client helper: `src/lib/transcribe-client.ts` does fetch → decode → resample → chunk → POST → PUT×N, and resumes a partial run.

## Search

| Method | Path | Query | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/search` | `?q=&mode=quick\|fts\|semantic\|hybrid&type=&tag=&match=all\|any` | `{ mode, hits, degraded }`. Default `hybrid`. Each hit has `match: { text, startMs } \| null`, set when the card matched through a transcript chunk. `semantic` → `503 {"error":"embeddings not configured"}` when no provider; `hybrid` silently falls back to FTS with `degraded: true`. `match=any` ORs the query's lexemes (fts/hybrid only); default requires every term |

## Ask

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/ask` | `{ question (1–2000 chars), type?, tag? }` | Streams `application/x-ndjson`, one `AskEvent` per line: first `{type:"sources", sources[], degraded, model}` (`model` is `null` when the provider is off), then `{type:"delta", text}`… and `{type:"done", citations[]}`, or `{type:"error", message}`. Each source has `index` (1-based, what the answer cites as `[n]`), `id`, `type`, `title`, `excerpt` (file embeds and attachment links stripped; a transcript hit leads with `Transcript at m:ss: <matched chunk>`), `url`, `createdAt`, `score`. Retrieval mode, passage count/length, model and answer limits come from the ask settings. Retrieval finishes before the response is committed; without a model, `done` follows `sources` immediately |

## Settings

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/settings/ask` | — | `{ settings }`: `provider` (`workers-ai`\|`none`), `model`, `retrieval` (`hybrid`\|`fts`\|`semantic`), `match` (`any`\|`all`), `sourceLimit` 1–20, `excerptChars` 200–6000, `maxTokens` 64–4096, `temperature` 0–2, `systemPrompt` ≤4000. Defaults in `src/lib/ask-config.ts` |
| `PUT` | `/api/settings/ask` | any subset of the above | Merges over the stored document; unmentioned keys keep their value. Out-of-range → `400 {"error":"<key>: <message>"}`. Returns `{ settings }` after the merge |

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
| `GET` | `/api/files/:id/:variant` | `variant ∈ original\|thumb-400\|thumb-1200`, `?proxy=1` | 302 to a short-TTL presigned GET. Non-images fall back to `original`. `original?proxy=1` streams the bytes through the Worker instead (the bucket has no CORS, and the transcriber must `fetch()` them) |

Client helper: `src/lib/upload-client.ts` does hash → presign → PUT → confirm.

## Share and export

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/share` | Accepts `CAPTURE_TOKEN`. `multipart/form-data` with `title`, `text`, `url`, `files[]` (images) — the Android PWA share target (`public/manifest.webmanifest`) and the iOS Shortcut. The link is `url`, else the first `http(s)` URL in `text` (removed from the body). A link whose canonical URL already belongs to a live card returns that card instead of a duplicate, unless images are attached. Creates a card with `props.source.via = "share"`. With `Accept: application/json`: `201 { card, existing: false }` or `200 { card, existing: true }`; otherwise 303 to `/cards/:id` |
| `GET` | `/api/export` | Streams a zip: every card as markdown with YAML front-matter (id, type, title, tags, …) plus every referenced file |

## Maintenance

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`POST` | `/api/admin/gc` | Garbage collection; `GET` is what the Cron Trigger sends. Returns counts of what it removed |
| `GET`/`POST` | `/api/admin/embed-sweep` | Embed stale/unembedded cards in a batch, retry YouTube transcripts stuck for 10+ minutes, embed unembedded transcript chunks. `{ embedded, chunksEmbedded, transcriptsRetried }` |
| `POST` | `/api/admin/reconcile` | Diff bucket keys against `files.r2_prefix`; delete strays |

Schedules live in `wrangler.jsonc` → `triggers.crons` and are dispatched by `worker.ts`.
