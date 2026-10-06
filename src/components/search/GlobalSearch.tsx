"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTyping, Kbd } from "@/components/brain/parts";
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
 * ⌘K search palette. The header shows only a trigger; the overlay is
 * portaled to <body> (the header's backdrop-filter would otherwise clip a
 * fixed child) and carries the hybrid (text + semantic) search, opening hits
 * in the card modal. `/` opens it too, unless the user is already typing.
 */
export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (cmdK || slash) {
        e.preventDefault();
        setOpen((o) => (cmdK ? !o : true));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQ("");
  }, [open]);

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

  const select = useCallback(
    (hit: Hit) => {
      close();
      if (hit.type === "board") router.push(`/boards/${hit.id}`);
      // The detail modal lives on `/`; elsewhere (e.g. a board) navigate there.
      else if (pathname === "/") openCard(hit.id);
      else router.push(`/?card=${hit.id}`);
    },
    [close, pathname, router],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (hits.length === 0) return;
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

  const searching = q.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Meta+K"
        className="flex h-8 w-full min-w-0 max-w-xs items-center gap-2 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px] text-ink-faint transition-colors hover:border-line-2 hover:text-ink"
      >
        <span>&gt;</span>
        <span className="hidden flex-1 text-left sm:block">search…</span>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-inset/80 p-4 pt-[min(18vh,10rem)] backdrop-blur-sm transition-opacity duration-150 starting:opacity-0"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-label="Search"
              className="w-full max-w-xl overflow-hidden rounded-xl border border-line-2 bg-surface-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <span className="font-mono font-bold text-accent">{loading ? "…" : ">"}</span>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search everything…"
                  aria-label="Search"
                  role="combobox"
                  aria-expanded={searching}
                  aria-controls="global-search-results"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-sm text-ink caret-accent outline-none placeholder:text-ink-faint"
                />
                <Kbd>esc</Kbd>
              </div>

              {searching && (
                <div id="global-search-results" role="listbox">
                  {degraded && (
                    <div className="border-b border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-amber">
                      semantic index unavailable — text only
                    </div>
                  )}
                  {hits.length === 0 ? (
                    <div className="px-4 py-4 font-mono text-[12px] text-ink-faint">
                      {loading ? "searching…" : `no matches for "${q.trim()}"`}
                    </div>
                  ) : (
                    <ul className="max-h-[50dvh] overflow-y-auto p-1.5">
                      {hits.map((hit, i) => {
                        const style = styleFor(hit.type);
                        const isActive = i === active;
                        return (
                          <li key={hit.id} role="option" aria-selected={isActive}>
                            <button
                              type="button"
                              onMouseEnter={() => setActive(i)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => select(hit)}
                              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                                isActive ? "bg-accent/10 text-accent" : "text-ink-dim"
                              }`}
                            >
                              <span className={`w-5 flex-none text-center font-mono text-sm ${isActive ? "" : style.text}`}>
                                {style.glyph}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[13px]">{snippet(hit)}</span>
                              <span className="flex-none font-mono text-[10px] text-ink-faint">{relativeTime(hit.createdAt)}</span>
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
          </div>,
          document.body,
        )}
    </>
  );
}
