# Second Brain

A personal, self-owned knowledge base: part inbox, part library, part infinite canvas. Single user, private on the web, built to outlive any vendor.

Everything you capture — a thought, a quote, a link, a photo, a PDF, a mantra, a project — is one kind of thing: a **card**. Cards land in an inbox with zero ceremony (`⌘J`, type, `⌘↵`), get found again by hybrid full-text + semantic search (`⌘K`), and get arranged on spatial **boards** (tldraw) where a card can appear in as many places as it belongs. Your bytes live in a Postgres database and an S3 bucket you control, with a one-click export to markdown + files.

- **Live:** single-tenant deployment on Cloudflare Workers (yours would be your own)
- **Product brief:** [`PROJECT.md`](PROJECT.md) — vision, principles, schema, and the rules that must not be broken
- **Docs:** [`docs/`](docs/README.md) — architecture, local setup, deployment, decisions, conventions, API

## What it does

| Surface | Where | Notes |
| --- | --- | --- |
| **Capture** | `⌘J` anywhere, `+ Add` button, PWA share sheet, `POST /api/cards` with a bearer token | `# Title` on line one; a leading URL becomes a link card with its OpenGraph preview cached into your bucket; drop/paste files; pick a kind (board, project, mantra…) |
| **Inbox** | `/` | Untriaged cards, newest first, as a day-grouped timeline or a masonry desk. Archive (`e`), tag (`t`), or file to a board (`b`) from the card modal |
| **Library** | `/?scope=library` | Every card. Filters are three multi-select menus — kind, source (typed / web domain / shared / uploaded / book), tag — with live counts; state lives in the URL |
| **Search** | `⌘K` or `/` | Quick (typo-tolerant trigram), full-text (`tsvector`), semantic (pgvector), or hybrid (reciprocal rank fusion). Degrades to full-text when no embeddings exist |
| **Boards** | `/boards/:id` | tldraw canvas with custom card shapes rendering real card content. Placements are many-to-many; boards are cards, so they nest |
| **Ask** | `/ask` | Question in, answer out, every claim cited `[n]` back to a card. Retrieval is hybrid search; the model is pluggable behind `LLM_PROVIDER`. With no model configured it shows the passages a model would read |
| **Settings** | `/settings` | Export everything (zip of markdown + files), run GC, reconcile storage, embed stale cards, sign out |

## Stack at a glance

Next.js 16 (App Router, React 19) · Tailwind v4 · tldraw 5 · Drizzle on Postgres (pgvector, pg_trgm) · S3-compatible object storage (R2 in prod, MinIO locally) · Cloudflare Workers via `@opennextjs/cloudflare`, with Hyperdrive (Neon), Images, and Workers AI (`@cf/baai/bge-m3`) bindings · iron-session cookie auth with a PBKDF2 password hash · pnpm, strict TypeScript, vitest.

Full picture in [`docs/architecture.md`](docs/architecture.md).

## Quick start (local)

Prerequisites: Node 22, pnpm 11 (`corepack enable` or `npm i -g pnpm`), Docker.

```sh
git clone https://github.com/J-Krush/Second-Brain.git && cd Second-Brain
pnpm install

# 1. Local Postgres (pgvector) + MinIO, with the bucket pre-created
docker compose up -d

# 2. Secrets
cp .env.example .env.local
pnpm hash-password "choose a password"        # paste the output into APP_PASSWORD_HASH
openssl rand -hex 32                          # -> SESSION_SECRET
openssl rand -hex 32                          # -> API_TOKEN (and CRON_SECRET)

# 3. Schema
pnpm db:migrate

# 4. Run
pnpm dev                                      # http://localhost:3001
```

Log in with the password you hashed. Semantic search is off until you add `CF_ACCOUNT_ID` + `CF_AI_TOKEN` (Workers AI via REST); everything else works offline. Details, gotchas, and the `wrangler` preview path are in [`docs/local-development.md`](docs/local-development.md).

## Deploying your own

The app is one Cloudflare Worker plus a Neon database and an R2 bucket; GitHub Actions migrates then deploys on every push to `main`. Step-by-step in [`docs/deployment.md`](docs/deployment.md).

## Working on it

- `pnpm typecheck && pnpm test` is the CI gate; there is no linter or formatter in the repo, so keep diffs tidy by hand.
- Changes go through PRs; `main` is deploy-on-push.
- Read [`docs/conventions.md`](docs/conventions.md) before writing code — it is written for humans and coding agents alike and covers the rules that are not obvious from the source.
- Important choices and the reasons behind them (and the things that bit us) are in [`docs/decisions.md`](docs/decisions.md). Add to it when you make one.

## Non-goals (v1)

Multi-user anything, real-time sync between devices, the auto-generated global graph, mobile board editing, chunked embeddings for long documents. See [`PROJECT.md`](PROJECT.md#non-goals-v1).

## License

[MIT](LICENSE). Take it, adapt it, deploy your own. The license covers the code; whatever you put into your instance is yours.
