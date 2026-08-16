"use client";

import { useCallback, useEffect, useState } from "react";
import { CARD_STYLE } from "./card-style";
import { CardRow, type CardLike } from "./CardRow";

interface TagOption {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

const TYPES = Object.keys(CARD_STYLE);
type Mode = "hybrid" | "fts" | "semantic" | "quick";
const MODE_LABELS: Record<Mode, string> = {
  hybrid: "Hybrid",
  fts: "Full-text",
  semantic: "Semantic",
  quick: "Quick",
};

export function LibraryView({ tags }: { tags: TagOption[] }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [type, setType] = useState<string | null>(null);
  const [tagId, setTagId] = useState<number | null>(null);
  const [items, setItems] = useState<CardLike[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      const query = q.trim();
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (tagId !== null) params.set("tag", String(tagId));
      let rows: CardLike[] = [];
      if (query) {
        params.set("q", query);
        params.set("mode", mode);
        const res = await fetch(`/api/search?${params}`, { signal }).catch(() => null);
        if (res?.ok) {
          const data = await res.json();
          rows = data.hits ?? [];
          setDegraded(Boolean(data.degraded));
        }
      } else {
        params.set("view", "library");
        const res = await fetch(`/api/cards?${params}`, { signal }).catch(() => null);
        if (res?.ok) rows = (await res.json()).items ?? [];
      }
      setItems(rows);
      setLoading(false);
    },
    [q, mode, type, tagId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => void load(ctrl.signal), 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the library…"
          className="flex-1 rounded-lg border border-line bg-surface px-4 py-2 text-ink outline-none placeholder:text-ink-faint focus:border-accent-dim"
        />
        {q.trim() && (
          <div className="flex overflow-hidden rounded-lg border border-line text-sm">
            {(["hybrid", "fts", "semantic", "quick"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 ${
                  mode === m ? "bg-surface-2 text-ink" : "text-ink-faint"
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={type ?? ""}
          onChange={(e) => setType(e.target.value || null)}
          className="rounded-md border border-line bg-base px-2 py-1 text-sm text-ink-dim outline-none"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {CARD_STYLE[t]!.label}
            </option>
          ))}
        </select>
        {tags.map((t) => (
          <button
            key={t.id}
            onClick={() => setTagId(tagId === t.id ? null : t.id)}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              tagId === t.id
                ? "border-accent text-accent"
                : "border-line text-ink-dim hover:text-ink"
            }`}
          >
            {t.name} <span className="text-ink-faint">{t.count}</span>
          </button>
        ))}
      </div>

      {degraded && q.trim() && (mode === "hybrid" || mode === "semantic") && (
        <p className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-faint">
          Semantic search is off (no embedding key set). Showing full-text results.
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="py-12 text-center text-ink-faint">Searching…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-ink-faint">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((card) => (
            <CardRow key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
