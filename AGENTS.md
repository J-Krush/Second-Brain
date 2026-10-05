<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Second Brain — agent orientation

Single-user knowledge base: Next.js 16 on Cloudflare Workers, Postgres (pgvector) + S3 storage. Read these before editing, in this order:

1. `docs/conventions.md` — the rules. Workflow, code rules marked **(not obvious)**, front-end patterns, keyboard map, design tokens, verification policy, recipes.
2. `docs/architecture.md` — where things live and how a request, file, search, or cron flows.
3. `PROJECT.md` — the product brief and the principles that must not be violated (everything is a card, no `parent_id`, capture never requires a location, own the bytes).
4. `docs/decisions.md` — why things are the way they are. Add an entry when you change something foundational.
5. `docs/api.md` — route contracts. Update it when you add or change a route.

## Non-negotiables

- Never push to `main`; branch and open a PR. CI gate is `pnpm typecheck && pnpm test`, and it is not sufficient — exercise the changed surface in the running app and say what you ran.
- Every page calls `requireSession()`, every API route calls `authorize()`. There is no middleware.
- Migrations are additive-first and must work against the currently deployed Worker (CI migrates before deploying).
- Reuse the existing pattern (one way to fetch, filter, overlay, authorize). Delete what you replace; no shims.
- Keep docs in the same PR as the behaviour they describe.

Local setup: `docs/local-development.md` (`docker compose up -d`, `.env.example`, `pnpm db:migrate`, `pnpm dev` on :3001).
