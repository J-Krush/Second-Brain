/**
 * Provenance of a card: where it came from. Stored at `props.source`;
 * `sourceOf` validates it and falls back to the url / "typed".
 */
export type Source =
  | { via: "typed" }
  | { via: "web"; domain: string }
  | { via: "share"; app?: string }
  | { via: "upload"; filename: string }
  | { via: "book"; author?: string; work?: string; page?: string };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function parseSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  switch (s.via) {
    case "typed":
      return { via: "typed" };
    case "web": {
      const domain = str(s.domain);
      return domain ? { via: "web", domain } : null;
    }
    case "share": {
      const app = str(s.app);
      return app ? { via: "share", app } : { via: "share" };
    }
    case "upload": {
      const filename = str(s.filename);
      return filename ? { via: "upload", filename } : null;
    }
    case "book": {
      const out: Source = { via: "book" };
      const author = str(s.author);
      const work = str(s.work);
      const page = typeof s.page === "number" ? String(s.page) : str(s.page);
      if (author) out.author = author;
      if (work) out.work = work;
      if (page) out.page = page;
      return out;
    }
    default:
      return null;
  }
}

export function sourceOf(card: { props: unknown; url: string | null }): Source {
  const props = card.props;
  if (props && typeof props === "object") {
    const parsed = parseSource((props as Record<string, unknown>).source);
    if (parsed) return parsed;
  }
  if (card.url) {
    const domain = domainOf(card.url);
    if (domain) return { via: "web", domain };
  }
  return { via: "typed" };
}

export function sourceLabel(s: Source): string {
  switch (s.via) {
    case "typed":
      return "typed";
    case "web":
      return s.domain;
    case "share":
      return s.app ? `shared from ${s.app}` : "shared";
    case "upload":
      return s.filename;
    case "book": {
      const head = [s.author, s.work].filter(Boolean).join(", ") || "book";
      return s.page ? `${head} p.${s.page}` : head;
    }
  }
}

/**
 * Facet identity for filtering: web sources group by domain (`web:<domain>`),
 * everything else by how it arrived. Mirrors the SQL in `listCards`.
 */
export type SourceFilter = { via: Exclude<Source["via"], "web"> } | { via: "web"; domain: string };

export function sourceKey(s: Source): string {
  return s.via === "web" ? `web:${s.domain}` : s.via;
}

export function parseSourceKey(key: string): SourceFilter | null {
  if (key.startsWith("web:")) {
    const domain = key.slice(4);
    return domain ? { via: "web", domain } : null;
  }
  return key === "typed" || key === "share" || key === "upload" || key === "book" ? { via: key } : null;
}

/** Short label for a source facet, as opposed to a card's full provenance line. */
export function sourceFacetLabel(f: SourceFilter): string {
  switch (f.via) {
    case "web":
      return f.domain;
    case "typed":
      return "typed";
    case "share":
      return "shared";
    case "upload":
      return "uploaded";
    case "book":
      return "books";
  }
}
