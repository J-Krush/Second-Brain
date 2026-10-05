"use client";

import { styleFor } from "@/components/card-style";
import { replaceParams } from "@/lib/card-url";
import type { Scope, View } from "./item";

export interface TagOption {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

/**
 * The bar under the composer: scope (inbox/library) on the left, kind + tag
 * filters, view (timeline/desk) on the right. Everything lives in the URL;
 * defaults are dropped so `/` stays clean.
 */
export function Shell({
  scope,
  view,
  type,
  tagId,
  inboxCount,
  types,
  tags,
}: {
  scope: Scope;
  view: View;
  type: string | null;
  tagId: number | null;
  inboxCount: string | null;
  types: string[];
  tags: TagOption[];
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
      <div className="flex font-mono text-[11px] uppercase tracking-widest" role="tablist" aria-label="scope">
        {(["inbox", "library"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            onClick={() => replaceParams({ scope: s === "inbox" ? null : s })}
            className={`border-b-2 px-2.5 py-1 transition-colors ${
              scope === s ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
            }`}
          >
            {s}
            {s === "inbox" && inboxCount !== null && <span className="ml-1.5 text-accent">{inboxCount}</span>}
          </button>
        ))}
      </div>

      <div className="sb-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[12px]">
        <Pill active={type === null} onClick={() => replaceParams({ type: null })}>
          all
        </Pill>
        {types.map((t) => {
          const s = styleFor(t);
          return (
            <Pill key={t} active={type === t} onClick={() => replaceParams({ type: type === t ? null : t })} title={s.label}>
              <span className={type === t ? "" : s.text}>{s.glyph}</span>
              <span className="hidden xl:inline">{s.label.toLowerCase()}</span>
            </Pill>
          );
        })}
        {tags.length > 0 && (
          <select
            value={tagId ?? ""}
            onChange={(e) => replaceParams({ tag: e.target.value || null })}
            aria-label="filter by tag"
            className={`ml-1 rounded-full border bg-transparent px-2.5 py-1 outline-none transition-colors hover:border-line-2 ${
              tagId !== null ? "border-accent/60 text-ink" : "border-line text-ink-faint"
            }`}
          >
            <option value="">#&nbsp;any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name} ({t.count})
              </option>
            ))}
          </select>
        )}
      </div>

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

function Pill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
        active ? "bg-ink text-inset" : "text-ink-faint hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
