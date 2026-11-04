# Flow specs

One file per user-facing area. A spec is the contract a feature is built against and the checklist UAT grades it with: steps a user takes, and **observable** results (text, URL, counts, persisted state). Each spec has a Playwright test with a matching `// spec:` header. Write or update the spec in the same change as the behaviour.

```markdown
# <Area>

**Seed:** `tests/seed.spec.ts`. Preconditions: <data state>

## 1. <Flow>

**Steps:**
1. …

**Expected:**
- …

## Adversarial

- Empty / max-length input, double submit, reload mid-flow, back, 390px viewport, stale tab, unknown ids.
```

Known bugs are listed inline as `(finding F<n>: …)` and their tests are `test.fail`, never skipped.
