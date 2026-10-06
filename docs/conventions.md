# Conventions

How code gets written and shipped here. Written for people and for coding agents; if you are an agent, read this whole page before editing. Rules that are not obvious from the source are marked **(not obvious)**.

## Workflow

- `main` deploys on push. **Never push to `main`**; branch, open a PR, let CI (`typecheck` + `test`) go green, merge.
- One PR = one coherent change with a description that says what was built *and what was exercised* to prove it (see Verification).
- `AGENTS.md` is the agent entry point (`CLAUDE.md` imports it). Its first block is owned by `next dev` and committed verbatim **(not obvious)**; edit only the project section below it.
- Keep [`../PROJECT.md`](../PROJECT.md) and these docs in the same PR as the behaviour they describe. [`decisions.md`](decisions.md) gets an entry for anything foundational.
- Migrations: next number in `src/db/`, backward compatible with the deployed Worker (CI migrates *before* deploying), then mirror in `src/db/schema.ts`. Never edit an applied migration.

## Code rules

Stack: TypeScript `strict` + `noUncheckedIndexedAccess`, React 19, Next 16 App Router, Tailwind v4, pnpm. No ESLint, no Prettier — match the surrounding style by hand (2-space, double quotes, trailing commas, ~110 columns).

- **Reuse the existing pattern before inventing one.** There is one way to fetch (`fetch` + `onCardChanged` refresh), one way to filter (`FacetMenu`), one way to overlay (portal to `document.body`), one way to authorize (`authorize()` / `requireSession()`). A second convention is a bug.
- **No tiny one-line wrapper functions** **(not obvious)**. If a helper is one expression used once, inline it.
- **No `ReturnType<typeof fn>`** **(not obvious)**. Name the interface and export it from the module that owns the data (`CreatedCard`, `Facets`, `ListParams`).
- **No inline-cast member access** like `(x as Foo).bar` **(not obvious)**. Narrow with a typed boundary interface at the edge (see `AiEnv`, `ImagesEnv`, `DbEnv`) and keep the rest of the code cast-free.
- **`Record<string, T>` over `Map`** for keyed lookups **(not obvious)**: `CARD_TYPES`, `CRON_ROUTES`, `SOURCE_GLYPH`.
- Delete obsolete code in the same change: no shims, re-exports, or "deprecated" paths. Every caller migrates.
- Comments explain *why* (a platform constraint, a product rule), never *what*. Doc comments on exported functions and components, one paragraph, present tense.
- Server code never trusts the client for derived state: file references are re-derived from the body on every save; `triaged_at`, `props.source`, and embeddings are set server-side.
- The DB handle is request-scoped (`src/db/index.ts`): `import { db }` and use it inside the handler; never cache it.
- Every new page calls `requireSession()`; every new API route calls `authorize()` first. There is no middleware to save you.

## Front-end rules

- **URL is state.** Scope, view, filters, and the open card live in the query string via `replaceParams()` / `openCard()` in `src/lib/card-url.ts`. Components read `useSearchParams()`; nothing duplicates URL state into React state.
- **Mutations announce themselves.** After any write, call `emitCardChanged()` (`src/lib/card-events.ts`); the stream, counts, and facets refetch. Do not thread callbacks through props for this.
- **Overlays portal to `document.body`** and copy the search palette's chrome: centered panel, `bg-surface-2`, `border-line-2`, `rounded-xl`, `shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]`, header row in `font-mono text-[10px] uppercase tracking-widest`, `Kbd` hints.
- **Menus are `FacetMenu`.** Multi for filters, `multi={false}` for pickers. Rows show `glyph label count`; active row is `bg-accent/10 text-accent`. The one exception is attaching tags, which is `TagPicker` (it searches and creates); reuse it, don't build another.
- Keyboard first. Every overlay: `↑↓` move, `↵` select, `Esc` close; `Esc` inside a nested menu closes only the menu.

### Keyboard map (keep current)

| Key | Where | Action |
| --- | --- | --- |
| `⌘J` | everywhere | Toggle the capture dialog (`⌘N` is browser-reserved) |
| `⌘K`, `/` | everywhere | Open search |
| `⌘↵` | capture dialog | Save |
| `a` / `e` / `b` / `t` / `l` | card modal | Archive (inbox only) / edit / file to board / tag / connect a card |
| `Esc` | any overlay | Close |

### Design system

Dark only. Tokens in `src/app/globals.css`:

| Token | Value | Use |
| --- | --- | --- |
| `base` / `surface` / `surface-2` / `inset` | `#0a0c0e` / `#15191d` / `#1c2126` / `#060708` | page, card, raised panel, deepest inset |
| `line` / `line-2` | `#20262b` / `#2c343a` | hairline / stronger border |
| `ink` / `ink-dim` / `ink-faint` | `#f4f6f7` / `#b5bdc3` / `#7c868d` | text hierarchy |
| `accent` | `#b6ff2e` | the one signal colour: active tab underline, primary buttons (`bg-accent text-inset`), selected rows, untriaged dot |
| `cyan` / `amber` / `ember` / `red` | | links-outward, degraded notices, secondary signal, danger |

Type: `font-display` (Bricolage Grotesque) for titles, `font-sans` (Space Grotesk) for body, `font-mono` (JetBrains Mono) for chrome — labels, counts, hints, chips, all `uppercase tracking-widest` at 10–13px. Card kinds carry their own glyph and colour from `src/components/card-style.ts`; use `styleFor(type)`, never hard-code a kind's look.

## Verification

`pnpm typecheck && pnpm test` must pass, and is not enough. Before a PR:

- **Run the thing.** Open the dev server and exercise the changed path end to end — click it, press the key, hit the route with `curl`, check the row in `psql`. Screenshots in the PR are welcome.
- Bugs: reproduce before, confirm after.
- New pure logic with real edge cases gets a vitest case next to it (`src/lib/*.test.ts`). Do not write tests that pin wording, wiring, or incidental defaults; do not mock the DB to test a query.
- Edge-sensitive changes (`worker.ts`, bindings, `wrangler.jsonc`, anything touching `getCloudflareContext`) get a `pnpm preview` run.

## Adding things — recipes

**An API route.** `src/app/api/<path>/route.ts`, `export const runtime = "nodejs"`, `authorize()` first, parse input with zod, call a function in `src/lib/`, return `NextResponse.json`. Add the row to [`api.md`](api.md).

**A card kind.** Add it to `CARD_TYPES` (`src/lib/cards.ts`) and `CARD_STYLE` (`src/components/card-style.ts`); the composer's kind picker, facet menu, timeline typesetting, and desk tile pick it up from there. Only add a bespoke renderer in `Timeline.tsx`/`Desk.tsx` if the kind genuinely needs a different shape (quotes, links, boards do).

**A filter.** Extend `ListParams` + the SQL in `listCards`, parse the comma list in `src/app/api/cards/route.ts` with `csv()`, add the counts to `listFacets`, and render another `FacetMenu` in `Shell.tsx`. The URL key, the API key, and the facet key are the same word.

**A background job.** A route under `/api/admin/` guarded by `CRON_SECRET`, a cron expression in `wrangler.jsonc`, and the mapping in `worker.ts`. Add a button to `AdminActions.tsx` so it can be run by hand.
