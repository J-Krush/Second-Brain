# Ask

Retrieval-augmented answers over your cards at `/ask`. An answer needs Workers AI (`CF_ACCOUNT_ID` + `CF_AI_TOKEN` in dev, the `AI` binding when deployed). Retrieval works without it.

**Seed:** `tests/seed.spec.ts`. Preconditions: a card containing `<marker>` exists.

## 1. Ask a question

**Steps:**
1. Go to **ask**.
2. Type `what do I know about <marker>` and press `↵`.

**Expected:**
- `↵` sends; `⇧↵` inserts a newline.
- The sources list shows the matching card before any answer text arrives.
- With a provider configured: the answer streams in, `[n]` citations render as pills, and clicking a pill opens that card in a modal over the thread (`?card=`), without losing the thread.
- Without a provider: the thread shows `CF_ACCOUNT_ID / CF_AI_TOKEN not set`. With provider **Off** on `/settings`, the page labels itself a retrieval-only preview.

## 2. Stop mid-answer

**Steps:**
1. Ask a question and press **stop** while the answer streams.

**Expected:**
- Streaming stops; the partial answer stays visible.

## Adversarial

- Asking about something absent from the cards gives an honest "not in your notes", not an invented answer.
- Sending an empty question is not possible.
