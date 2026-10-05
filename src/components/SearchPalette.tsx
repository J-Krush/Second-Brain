"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { styleFor } from "./card-style";

interface Hit {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
}

/**
 * Global quick switcher. `/` opens it anywhere; typing runs the pg_trgm quick
 * search as-you-type; Enter/click jumps to the card. Esc closes.
 */
export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/search?mode=quick&q=${encodeURIComponent(query)}`,
        { signal: ctrl.signal },
      ).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        setHits(data.hits ?? []);
        setActive(0);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  function go(hit: Hit | undefined) {
    if (!hit) return;
    setOpen(false);
    router.push(`/cards/${hit.id}`);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(hits[active]);
            }
          }}
          placeholder="Jump to a card…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-ink outline-none placeholder:text-ink-faint"
        />
        <ul className="max-h-80 overflow-y-auto">
          {hits.map((hit, i) => {
            const style = styleFor(hit.type);
            return (
              <li key={hit.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
                    i === active ? "bg-surface-2" : ""
                  }`}
                >
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${style.badge}`}>
                    {style.label}
                  </span>
                  <span className="truncate text-sm text-ink">
                    {hit.title || hit.body || "Untitled"}
                  </span>
                </button>
              </li>
            );
          })}
          {q.trim() && hits.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-faint">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
