"use client";

import { useCallback, useEffect, useState } from "react";
import { openCapture } from "@/lib/capture-bus";
import { CARD_STYLE } from "./card-style";
import { CardGrid, type GridCard } from "./CardGrid";

interface TagOption {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

const TYPES = Object.keys(CARD_STYLE);

/**
 * Filterable, sortable grid of all cards: type, tag, and time (asc/desc).
 * Keyset "load more" pagination via the cards API cursor.
 */
export function CardBrowser({ tags }: { tags: TagOption[] }) {
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [type, setType] = useState<string | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [items, setItems] = useState<GridCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const buildParams = useCallback(
    (cur?: string | null) => {
      const params = new URLSearchParams({ view: "library", order });
      if (type) params.set("type", type);
      if (tagId !== null) params.set("tag", String(tagId));
      if (cur) params.set("cursor", cur);
      return params;
    },
    [order, type, tagId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    void (async () => {
      const res = await fetch(`/api/cards?${buildParams()}`, {
        signal: ctrl.signal,
      }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setCursor(data.nextCursor ?? null);
      }
      setLoading(false);
    })();
    return () => ctrl.abort();
  }, [buildParams]);

  async function loadMore() {
    if (!cursor) return;
    const res = await fetch(`/api/cards?${buildParams(cursor)}`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setCursor(data.nextCursor ?? null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => openCapture({})}
          className="rounded-lg bg-accent px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-inset"
        >
          + Capture
        </button>

        <button
          onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
          className="rounded-lg border border-line px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-dim hover:border-line-2 hover:text-ink"
          title="Sort by time"
        >
          {order === "desc" ? "newest \u2193" : "oldest \u2191"}
        </button>

        <select
          value={type ?? ""}
          onChange={(e) => setType(e.target.value || null)}
          className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-dim outline-none"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {CARD_STYLE[t]!.label}
            </option>
          ))}
        </select>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() => setTagId(tagId === t.id ? null : t.id)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                  tagId === t.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line text-ink-faint hover:border-line-2 hover:text-ink"
                }`}
              >
                {t.name} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && items.length === 0 ? (
        <p className="py-16 text-center font-mono text-sm text-ink-faint">loading…</p>
      ) : (
        <>
          <CardGrid cards={items} />
          {cursor && (
            <div className="mt-6 text-center">
              <button
                onClick={() => void loadMore()}
                className="rounded-lg border border-line px-5 py-2 font-mono text-xs uppercase tracking-wider text-ink-dim hover:text-ink"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
