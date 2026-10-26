// Share sheets hand us URLs decorated with per-share tracking (YouTube `si`,
// Instagram `igsh`, `utm_*`), so the same page shared twice would be two
// different strings. Canonicalising at save time keeps `cards.url` stable
// enough to dedupe on and strips tracking we do not want to own.
const TRACKING_PARAMS: Record<string, true> = {
  fbclid: true,
  gclid: true,
  igsh: true,
  igshid: true,
  si: true,
  feature: true,
  ref_src: true,
};

/**
 * Returns a stable form of `raw`: lowercase host, tracking params removed,
 * fragment dropped, trailing slash trimmed, `youtu.be/ID` and YouTube
 * `/shorts/ID` rewritten to `watch?v=ID`. Non-http(s) or unparsable input is
 * returned untouched.
 */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMS[key]) url.searchParams.delete(key);
  }

  const host = url.hostname.replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === "youtube.com" || host === "www.youtube.com") {
    const shorts = /^\/shorts\/([^/]+)/.exec(url.pathname);
    if (shorts) return `https://www.youtube.com/watch?v=${shorts[1]}`;
    const v = url.searchParams.get("v");
    if (url.pathname === "/watch" && v) return `https://www.youtube.com/watch?v=${v}`;
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}
