"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface BoardOption {
  id: string;
  title: string | null;
}

/**
 * Inline list of boards; picking one places the card at a random spot on it.
 * The caller decides what to do afterwards (emit, toast, close).
 */
export function BoardPicker({
  cardId,
  exclude = [],
  onPlaced,
  onClose,
}: {
  cardId: string;
  exclude?: string[];
  onPlaced: (board: BoardOption) => void;
  onClose: () => void;
}) {
  const [boards, setBoards] = useState<BoardOption[] | null>(null);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/cards?view=library&type=board&limit=200", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { items: BoardOption[] }) =>
        setBoards(data.items.map((b) => ({ id: b.id, title: b.title }))),
      )
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError("Couldn't load boards");
      });
    inputRef.current?.focus();
    return () => ctrl.abort();
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (boards ?? []).filter(
      (b) => b.id !== cardId && !exclude.includes(b.id) && (b.title ?? "untitled").toLowerCase().includes(f),
    );
  }, [boards, filter, cardId, exclude]);

  async function place(board: BoardOption) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/boards/${board.id}/placements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId, x: 80 + Math.random() * 400, y: 80 + Math.random() * 300 }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("Couldn't file to board");
      return;
    }
    onPlaced(board);
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2">
      <input
        ref={inputRef}
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const b = shown[active];
            if (b) void place(b);
          }
        }}
        placeholder="File to board…"
        className="w-full rounded-md bg-base px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint"
      />
      {error && <p className="px-1 pt-2 font-mono text-[11px] text-red">{error}</p>}
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {boards === null && !error && (
          <li className="px-2.5 py-1.5 font-mono text-[11px] text-ink-faint">loading…</li>
        )}
        {boards !== null && shown.length === 0 && (
          <li className="px-2.5 py-1.5 font-mono text-[11px] text-ink-faint">no boards</li>
        )}
        {shown.map((b, i) => (
          <li key={b.id}>
            <button
              type="button"
              disabled={busy}
              onMouseEnter={() => setActive(i)}
              onClick={() => void place(b)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] disabled:opacity-50 ${
                i === active ? "bg-surface-2 text-ink" : "text-ink-dim"
              }`}
            >
              <span className="text-accent">⊞</span>
              <span className="truncate">{b.title ?? "Untitled"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
