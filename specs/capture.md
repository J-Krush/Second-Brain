# Capture

Getting anything into the inbox from anywhere in the app. PROJECT.md: capture never requires a location.

**Seed:** `tests/seed.spec.ts` (logged in, on `/`)

## 1. Capture a thought with ⌘J

**Steps:**
1. From the inbox, press `⌘J` (`Ctrl+J` off macOS; headless Chromium only fires the `Ctrl` chord).
2. Type `# <marker> thought` then a newline and `body line`.
3. Press `⌘↵`.

**Expected:**
- The Capture dialog opens with the composer focused and the **capture** button disabled while empty.
- After saving, the dialog closes and a `captured → inbox` toast appears.
- The inbox count in the header goes up by one without a reload.
- The new card is at the top of today's group, titled `<marker> thought`, body `body line`, source `typed`.

## 2. Dismiss without saving

**Steps:**
1. Open capture, type some text, press `Esc`.
2. Open capture again with `⌘J`; then press `⌘J` again.

**Expected:**
- `Esc` closes the dialog and nothing is created (inbox count unchanged).
- `⌘J` toggles: the second press closes the dialog.
- Clicking the dimmed backdrop also closes it.

## 3. Capture a link

**Steps:**
1. Open capture, paste `https://example.com/`.
2. Save with `⌘↵`.

**Expected:**
- The kind picker switches to **link** once a URL is detected.
- The card appears immediately as a link card showing the `example.com` domain.
- Within a few seconds the card shows the page title (`Example Domain`) **without a manual reload**. OpenGraph capture runs in `after()`, after the response.

## 4. Capture from the + add button

**Steps:**
1. Click **+ add ⌘J** in the header.

**Expected:**
- The same Capture dialog opens as with the hotkey.

## Adversarial

- Double `⌘↵` creates exactly one card.
- Whitespace-only input cannot be captured (button stays disabled).
- A 390px-wide viewport: the dialog fits, nothing scrolls horizontally.
