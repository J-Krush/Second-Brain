# Card modal and triage

Opening a card and moving it out of the inbox. URL is state: `?card=<id>` owns the modal.

**Seed:** `tests/seed.spec.ts`. Preconditions: an untriaged card `<marker> thought`.

## 1. Modal is URL state

**Steps:**
1. Open the card (palette `↵` or its **open** button).
2. Reload the page.
3. Press browser back.

**Expected:**
- Opening sets `?card=<id>`; the modal shows title, body, a SOURCE section (`via typed`, captured timestamp), FILED (`+ board`, `+ tag`), and LINKS (`+ link`).
- After reload the same card's modal is still open.
- Back removes `?card=` and closes the modal; the stream underneath is unchanged.

## 2. Archive with `e`

**Steps:**
1. With the modal open on an untriaged card, press `e`.

**Expected:**
- Toast `archived to library`.
- The inbox count drops by one immediately.
- The card no longer appears in the inbox stream; it appears under **library**.

## 3. Tag with `t`

**Steps:**
1. In the modal, press `t`.
2. Type a new tag name and press `↵`.

**Expected:**
- `t` focuses the tag input.
- The tag chip appears in FILED with a `×` to remove it.
- Attaching a tag triages the card (API contract: "attaching auto-triages").
- The **tag** filter appears in the stream's filter row and lists the new tag.

## 4. Archive from the stream

**Steps:**
1. In the inbox, click **archive** on a card's hover actions.

**Expected:**
- Same outcome as `e`, without opening the modal: inbox count drops by one, the card leaves the inbox stream and appears under **library**. The toast here reads `archived · <title>`.

## Adversarial

- Hotkeys do nothing while typing in an input (pressing `e` in the tag field types an "e").
- `Esc` inside the tag input closes only the input; a second `Esc` closes the modal.
- Opening `?card=<nonexistent-uuid>` or `?card=not-a-uuid` shows a `card not found` state, not a crash.
