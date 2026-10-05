"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTyping } from "@/components/brain/parts";
import { styleFor } from "@/components/card-style";
import { openCard } from "@/lib/card-url";
import { relativeTime } from "@/lib/format";

interface Hit {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  score: number;
}

interface SearchResponse {
  mode: string;
  hits: Hit[];
  degraded?: boolean;
}

const DEBOUNCE_MS = 180;

function snippet(hit: Hit): string {
  if (hit.title) return hit.title;
  const s = (hit.body ?? hit.url ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Untitled";
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
}

/**
 * Header search box. `/` focuses it from anywhere; results are hybrid
 * (text + semantic) and open the card modal in place.
 */
export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  // `/` focuses the box unless the user is already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced fetch; stale responses are dropped via AbortController.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setDegraded(false);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?mode=hybrid&q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as SearchResponse;
        setHits(data.hits);
        setDegraded(Boolean(data.degraded));
        setActive(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const clear = useCallback(() => {
    setOpen(false);
    setHits([]);
    setQ("");
  }, []);

  const select = useCallback(
    (hit: Hit) => {
      clear();
      inputRef.current?.blur();
      if (hit.type === "board") router.push(`/boards/${hit.id}`);
      // The detail modal lives on `/`; elsewhere (e.g. a board) navigate there.
      else if (pathname === "/") openCard(hit.id);
      else router.push(`/?card=${hit.id}`);
    },
    [clear, pathname, router],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (open) setOpen(false);
      else {
        setQ("");
        inputRef.current?.blur();
      }
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) select(hit);
    }
  }

  const showList = open && q.trim().length > 0;

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 focus-within:border-accent-dim">
        <span className="font-mono text-[12px] text-ink-faint">{loading ? "…" : ">"}</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search everything…"
          aria-label="Search"
          role="combobox"
          aria-expanded={showList}
          aria-controls="global-search-results"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        {!q && (
          <kbd className="hidden rounded border border-line-2 px-1 font-mono text-[10px] text-ink-faint sm:inline">/</kbd>
        )}
      </div>

      {showList && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]"
        >
          {degraded && (
            <div className="border-b border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-amber">
              semantic index unavailable — text only
            </div>
          )}
          {hits.length === 0 ? (
            <div className="px-3 py-3 font-mono text-[12px] text-ink-faint">
              {loading ? "searching…" : "no matches"}
            </div>
          ) : (
            <ul className="max-h-[60dvh] overflow-y-auto py-1">
              {hits.map((hit, i) => {
                const style = styleFor(hit.type);
                return (
                  <li key={hit.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => select(hit)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                        i === active ? "bg-surface text-ink" : "text-ink-dim"
                      }`}
                    >
                      <span className={`w-5 flex-none text-center font-mono text-sm ${style.text}`}>{style.glyph}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{snippet(hit)}</span>
                      <span className="flex-none font-mono text-[10px] text-ink-faint">
                        {relativeTime(hit.createdAt)}
                      </span>
                      <span className="w-10 flex-none text-right font-mono text-[10px] tabular-nums text-ink-faint">
                        {hit.score.toFixed(2)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
