/**
 * `?card=<id>` opens the detail modal over whatever view is behind it. Pushed
 * (not replaced) so the browser back button closes the modal; every other
 * param (scope/view/type/tag) is preserved. `window.history` calls integrate
 * with the App Router, so `useSearchParams` consumers re-render.
 */
export function cardParam(params: URLSearchParams): string | null {
  return params.get("card");
}

export function openCard(id: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("card") === id) return;
  url.searchParams.set("card", id);
  window.history.pushState(null, "", url);
}

export function closeCard(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("card")) return;
  url.searchParams.delete("card");
  window.history.pushState(null, "", url);
}

/** Rewrites view-state params (scope/view/type/tag) in place; `null` removes. */
export function replaceParams(patch: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url);
}

/** Multi-value facet params are comma lists: `?type=thought,link`. */
export function csv(raw: string | null): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

export function joinCsv(values: string[]): string | null {
  return values.length ? values.join(",") : null;
}
