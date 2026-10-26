"use client";

import { useEffect, useState, type Ref } from "react";
import type { CardTag } from "@/lib/cards";

type Row = { tag: CardTag } | { create: string };

/**
 * Chips plus an input whose menu lists every existing tag not yet chosen,
 * filtered as you type; the last row creates the typed name when no tag has
 * it. Controlled: the caller decides what adding/removing means (attach to a
 * card now, or remember for a card about to be captured). ↑/↓/↵ in the menu,
 * Esc closes only the menu, ⌫ on an empty input removes the last chip.
 */
export function TagPicker({
  value,
  onAdd,
  onRemove,
  inputRef,
  direction = "down",
}: {
  value: CardTag[];
  onAdd: (tag: CardTag) => void;
  onRemove: (tag: CardTag) => void;
  inputRef?: Ref<HTMLInputElement>;
  direction?: "down" | "up";
}) {
  const [allTags, setAllTags] = useState<CardTag[]>([]);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  // Refetched on each focus so tags created or renamed elsewhere show up.
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch("/api/tags", { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ tags: CardTag[] }>) : { tags: [] }))
      .then((d) => setAllTags(d.tags))
      .catch(() => {});
    return () => ctrl.abort();
  }, [open]);

  const query = input.trim();
  const lower = query.toLowerCase();
  const chosen = new Set(value.map((t) => t.id));
  const rows: Row[] = allTags
    .filter((t) => !chosen.has(t.id) && t.name.toLowerCase().includes(lower))
    .map((tag) => ({ tag }));
  const exists = [...allTags, ...value].some((t) => t.name.toLowerCase() === lower);
  if (query && !exists) rows.push({ create: query });
  const current = rows[Math.min(active, rows.length - 1)];

  function add(tag: CardTag) {
    setInput("");
    setActive(0);
    onAdd(tag);
  }

  async function pick(row: Row) {
    if ("tag" in row) return add(row.tag);
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: row.create }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    const { tag }: { tag: CardTag } = await res.json();
    setAllTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    add(tag);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && open && rows.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (rows.length) setActive((i) => (Math.min(i, rows.length - 1) + step + rows.length) % rows.length);
    } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (open && current) void pick(current);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      onRemove(value[value.length - 1]!);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((t) => (
        <span
          key={t.id}
          className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-dim"
          style={t.color ? { borderColor: t.color, color: t.color } : undefined}
        >
          #{t.name}
          <button
            type="button"
            onClick={() => onRemove(t)}
            className="text-ink-faint hover:text-red"
            aria-label={`remove ${t.name}`}
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-label="tags"
          placeholder="+ tag"
          className="w-24 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:w-40 focus:border-accent/60"
        />
        {open && rows.length > 0 && (
          <ul
            role="listbox"
            aria-label="tags"
            className={`absolute left-0 z-30 max-h-64 min-w-[13rem] max-w-[20rem] overflow-y-auto rounded-lg border border-line-2 bg-surface-2 p-1 font-mono text-[12px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)] ${
              direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
            }`}
          >
            {rows.map((row, i) => (
              <li key={"tag" in row ? row.tag.id : "+"} role="option" aria-selected={row === current}>
                <button
                  type="button"
                  tabIndex={-1}
                  // Keep focus in the input so blur doesn't close the menu before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void pick(row)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${
                    row === current ? "bg-accent/10 text-accent" : "text-ink-dim"
                  }`}
                >
                  {"tag" in row ? (
                    <>
                      <span
                        className="size-2 flex-none rounded-full"
                        style={{ background: row.tag.color ?? "var(--color-ink-faint)" }}
                      />
                      <span className="min-w-0 flex-1 truncate">#{row.tag.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 flex-none text-center">+</span>
                      <span className="min-w-0 flex-1 truncate">create #{row.create}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
