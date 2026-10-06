# Ingestion

Getting things into the brain from wherever you are, in under two seconds. Every path ends at the same place: an untriaged card in the inbox.

| Where you are | How | Lands as |
| --- | --- | --- |
| iPhone, any app with a share button (Instagram, YouTube, Brave, Safari, Signal, Messages) | Share → **Send to Brain** (an Apple Shortcut) | `link` card for a URL, `thought` for plain text |
| iPhone, a thought in your head | Home-screen **Brain** icon — opens straight into the capture dialog | whatever you type |
| Android | Install the PWA; it appears in the system share sheet | same as above, plus shared images |
| Desktop | `⌘J` anywhere in the app | whatever you type, paste, or drop |
| Scripts, menu-bar app | `POST /api/cards` or `POST /api/share` with a bearer token ([`api.md`](api.md)) | |

## Why iOS uses a Shortcut

iOS Safari does not implement the web app manifest's `share_target` ([WebKit bug 194593](https://webkit.org/b/194593)), so an installed PWA can never appear in the iOS share sheet. A Shortcut with *Show in Share Sheet* can, runs without leaving the app you are in, and needs no App Store build. The PWA's `share_target` still serves Android. See [D21](decisions.md#d21--ios-capture-is-a-shortcut-not-the-pwa-share-target).

## Setting up the iPhone

1. **Create the capture token.** It is create-only: it can add cards and nothing else, so a lost phone cannot read or export the brain.

   ```sh
   openssl rand -hex 32 | tee /dev/stderr | gh secret set CAPTURE_TOKEN
   ```

   Re-run the deploy workflow so the Worker picks it up. Keep the printed value for step 2.

2. **Install the Shortcut** (on a Mac signed into the same iCloud account; it syncs to the phone):

   ```sh
   plutil -convert binary1 -o /tmp/stb.shortcut docs/shortcuts/send-to-brain.plist
   shortcuts sign -m anyone -i /tmp/stb.shortcut -o ~/Desktop/"Send to Brain.shortcut"
   open ~/Desktop/"Send to Brain.shortcut"
   ```

   *Add Shortcut* asks two questions: the endpoint (`https://<your host>/api/share`) and the `CAPTURE_TOKEN`. To change either later, open the shortcut and edit its first two Text actions. No Mac? AirDrop the signed file to the phone, or build it by hand from the steps below.

3. **Allow the network call once.** The first share asks *Allow "Send to Brain" to connect to `<host>`?* — choose **Always Allow**, or every later share asks again.

4. **Pin it.** Open any share sheet → scroll the action row → *Edit Actions…* → add *Send to Brain* to Favorites so it sits at the top.

5. **Home-screen app.** In Safari, open the brain → Share → *Add to Home Screen*. It runs full-screen (no Safari chrome; `viewport-fit=cover` plus safe-area padding keep the header out from under the clock) and cold-launches into the capture dialog (`start_url` is `/?capture=1`; change that one line in `public/manifest.webmanifest` to `/` for a plain inbox). The installed app has its own cookie jar, so log in once more there. When you come back to it after 30 s away, `ResumeRefresh` refetches the inbox, counts, and facets, so a card saved from the share sheet is already there. Fields are at least 16px on touch devices so iOS never zooms in on focus. There is no offline mode by design (`public/sw.js` is network passthrough).

What the Shortcut does (`docs/shortcuts/send-to-brain.plist` is the source; change it there, not only on your phone):

1. Accepts URLs, text, rich text, and Safari pages from the share sheet.
2. `POST`s the input as the multipart `text` field to `/api/share` with `Authorization: Bearer <CAPTURE_TOKEN>` and `Accept: application/json`.
3. Reads `card.id` from the response and shows *Saved to Brain*; on any other response it shows *Brain didn't save that* with the server's reply (`{"error":"unauthorized"}` means the token is wrong).

## What happens to a share

- **The link is found wherever the app put it.** YouTube and Brave send a bare URL; Instagram, Signal, and Messages often wrap it in a caption. The first `http(s)` URL becomes the card's `url`; the surrounding text stays as the body.
- **URLs are canonicalised** (`src/lib/link-url.ts`): tracking params (`utm_*`, `si`, `igsh`, `fbclid`, …) and fragments are dropped, `youtu.be/ID` and `/shorts/ID` become `youtube.com/watch?v=ID`.
- **Sharing the same thing twice is free.** If a live card already has that canonical URL, the existing card comes back (`200`, `existing: true`) instead of a duplicate. Shares that carry images always create a new card.
- **Previews are fetched after the response**, so the share sheet closes immediately:
  - YouTube: title, channel, and thumbnail from YouTube's oEmbed endpoint, which needs no API key.
  - Instagram: nothing is fetched. Instagram serves a login wall with no OpenGraph tags to non-browser clients; the card keeps the URL and any caption. Add a title in the card modal if you want one.
  - Everything else: OpenGraph/meta tags, with the image cached in R2.

## Limits

- The iOS Shortcut sends text and URLs, not images. For photos, use the home-screen icon and the capture dialog's image button; Android's share target accepts images directly.
- YouTube shares are `link` cards, not `video`; change the kind in the card modal if it matters.
- The Shortcut's notification reads *Saved to Brain* for both new and already-saved links.
