"use client";

import { styleFor } from "@/components/card-style";
import { joinCsv, replaceParams } from "@/lib/card-url";
import type { Facets } from "@/lib/cards";
import { FacetMenu, type FacetOption } from "./FacetMenu";
import type { View } from "./item";
import { SiteMark } from "./parts";

export interface TagOption {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

const SOURCE_GLYPH: Record<string, string> = {
  typed: "¶",
  share: "⇪",
  upload: "⎘",
  book: "❡",
};

/**
 * Sticky filter row: kind, source and tag as one kind of control, view
 * (timeline/desk) on the right. Scope lives in the header. Everything is in
 * the URL; defaults are dropped so `/` stays clean.
 */
export function Shell({
  view,
  types,
  sources: sourceKeys,
  tagIds,
  facets,
  tags,
}: {
  view: View;
  types: string[];
  sources: string[];
  tagIds: number[];
  facets: Facets | null;
  tags: TagOption[];
}) {
  const kinds: FacetOption[] = (facets?.kinds ?? []).map((k) => {
    const s = styleFor(k.type);
    return { key: k.type, label: s.label.toLowerCase(), count: k.count, glyph: <span className={s.text}>{s.glyph}</span> };
  });
  for (const t of types) {
    if (kinds.some((k) => k.key === t)) continue;
    const s = styleFor(t);
    kinds.push({ key: t, label: s.label.toLowerCase(), count: 0, glyph: <span className={s.text}>{s.glyph}</span> });
  }

  const sources: FacetOption[] = (facets?.sources ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    count: f.count,
    glyph: f.domain ? <SiteMark label={f.domain} className="size-4 text-[9px]" /> : <span className="text-ink-dim">{SOURCE_GLYPH[f.via]}</span>,
  }));
  for (const k of sourceKeys) {
    if (!sources.some((s) => s.key === k)) sources.push({ key: k, label: k.replace(/^web:/, ""), count: 0 });
  }

  const tagOptions: FacetOption[] = tags.map((t) => ({
    key: String(t.id),
    label: `#${t.name}`,
    count: t.count,
    glyph: <span className="size-2 rounded-full" style={{ background: t.color ?? "var(--color-ink-faint)" }} />,
  }));

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-2 py-2">
      <FacetMenu name="kind" values={types} options={kinds} onChange={(keys) => replaceParams({ type: joinCsv(keys) })} />
      <FacetMenu name="source" values={sourceKeys} options={sources} onChange={(keys) => replaceParams({ source: joinCsv(keys) })} />
      {tags.length > 0 && (
        <FacetMenu name="tag" values={tagIds.map(String)} options={tagOptions} onChange={(keys) => replaceParams({ tag: joinCsv(keys) })} />
      )}

      <div className="ml-auto flex rounded-lg bg-surface p-0.5 font-mono text-[12px]" role="tablist" aria-label="view">
        {(["timeline", "desk"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => replaceParams({ view: v === "timeline" ? null : v })}
            className={`rounded-md px-3 py-1 transition-colors ${
              view === v ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)]" : "text-ink-faint hover:text-ink"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
