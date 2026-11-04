---
name: uat
description: Adversarial user-acceptance testing of a running web app by an agent that did not build the change. Use when asked to QA, UAT, click through, or verify a branch/PR/preview/production; when the UAT gate blocks a PR; or when writing specs/ flow contracts and Playwright e2e tests. Not for unit tests.
---

# UAT

You are the evaluator, not the builder. Find what is broken, leave evidence, and leave a test that keeps it found. Builders grade their own work leniently; you exist because of that.

## When

- **Per branch, before the PR leaves draft**, against the whole diff (`<base>...HEAD`). Not after every task: subagents building pieces run unit tests and smoke their own change, and the branch gets one UAT pass.
- The gate enforces this. `gh pr create` (non-draft) and `gh pr ready` are blocked until HEAD has a receipt, and the session asks whether to run UAT, skip, or open a draft. Hooks: `.claude/hooks/uat-gate.sh` (Claude Code), `.omp/hooks/pre/uat-gate.ts` (OMP).
  - Run the PR command on its own, with nothing chained before it. The gate checks HEAD before the command runs, so `git commit && gh pr create` is refused.
  - Only the user skips. An agent never runs `skip` or `mode` on its own initiative; the hooks ask the user to approve both. With nobody to ask, run QA, open a draft, or stop and report.
- Receipts and toggles: `.claude/skills/uat/bin/uat-gate`:
  - `status`
  - `pass "<note>"` (recorded by `uat-qa` on 0 FAIL) / `skip "<why>"` / `skip --branch`
  - `mode ask|auto|off [--global]`. Mode is per clone (git config); `auto` runs QA without asking.

## Rules

- **Never evaluate work you built in this context.** If you wrote the change, delegate to the `uat-qa` agent (fresh context, this skill preloaded).
- Grade against the written contract (`specs/*.md`), not your impression. Every criterion gets **PASS** or **FAIL** with evidence. "Works with minor issues" is a FAIL with a finding.
- Do not read the builder's summary. Read the specs, the diff, and the running app.
- Reproduce each finding a second way (another input path, the API, a reload) before filing. Label it **app bug** or **harness artifact** (see Gotchas).
- Budget: stop at 10 findings or when every criterion in scope has a verdict.

## 0. Prove the target is the code under test

This catches the most expensive mistake: testing someone else's server.

- Local: find the process on the port and confirm its working directory is this checkout (`lsof -a -p <pid> -d cwd`). Parallel worktrees share a port range and DB container but usually **not** a database or secrets.
- Deployed: confirm the commit the URL serves matches HEAD.
- Note which database the target uses; your test data goes there and must be cleaned up.

## 1. Contract

- Read `specs/*.md`. If a changed flow has no spec, **write it first** (`specs/README.md` has the format) and show it to the user before testing.
- Scope: flows the diff touches, plus one neighbouring flow per touched area. Regressions tend to show up in the flows next to a change.

## 2. Execute

1. Run the suite: `UAT_BASE_URL=<url> <pm> e2e`. Failures in untouched flows are regressions.
2. Explore each in-scope flow the way a user does: hotkeys, clicks, back button. Then check the persisted outcome through the API or DB, because a toast is not proof.
   - OMP: `browser` tab; `tab.recordStart("uat/<flow>.mp4")` for any flow longer than three steps.
   - Claude Code: the `playwright-test` MCP server from `.mcp.json`; for clips, run the spec with `UAT_VIDEO=on` (videos land in the e2e results directory).
3. Adversarial pass:
   - Empty, whitespace-only, max-length, unicode/emoji input
   - Double submit; rapid repeated hotkeys
   - Reload mid-flow; back/forward; deep-link straight to a stateful URL
   - Stale tab: mutate in tab A, act in tab B
   - 390px viewport: horizontal overflow, unreachable controls
   - Offline toggle during a save
   - Unknown or deleted ids in the URL
   - Async work finishing after the response (enrichment, uploads, jobs): does the UI update **without a reload**?
4. Check the console and page errors after every flow; uncaught errors are findings.

## 3. Report

```
## UAT: <target> @ <sha>  —  PASS | FAIL | BLOCKED  (N PASS / M FAIL)
| # | Criterion (spec §) | Verdict | Evidence |
### F1 · <one-line symptom>   [app bug | harness artifact]
Expected: … (spec §)
Observed: …
Repro: 1. … 2. …
Second confirmation: … (API/DB/other path)
Suspected cause: file:line (only if cheap to find)
Receipt: <video/screenshot path>
```

## 4. Codify

- Passing flows become Playwright tests (one file per spec, `// spec:` and `// seed:` headers). Playwright's generator agent in `.claude/agents/` can draft them from a spec.
- A confirmed app bug becomes `test.fail(true, "F<n>: <cause>")` on the test asserting the **correct** behaviour. The suite stays green, the bug stays visible, and the day it is fixed the test reports an unexpected pass, which forces removing the annotation. Never `test.skip`/`test.fixme` a bug away, and reject healer-agent output that does.
- Tests create uniquely-marked data and delete it in teardown; never assume an empty database.
- Commit tests/specs, then record the verdict: `uat-gate pass` only when step 0 proved the target, the suite ran green, and there are 0 FAIL. An unproven target or nothing runnable is BLOCKED, never a pass.

## Gotchas (harness artifacts, not app bugs)

- **Meta chords** (`⌘J`) often fail to dispatch in headless Chromium. Use `Control+…` when the handler accepts `ctrlKey`.
- **Hydration race:** server-rendered chrome is visible before window key listeners attach. Retry the hotkey until the overlay shows (`expect(...).toPass()`), and take baselines from the API, not from client-fetched badges.
- **Controlled inputs** may ignore select-all + backspace. Reopen the overlay between queries, or use `fill`.
- **Optimistic UI**: a chip or toast appears before the write lands. Poll the API for persisted state.
- **Rate-limited login**: authenticate once and share `storageState`; never loop logins against production.
