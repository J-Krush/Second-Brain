"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface FacetOption {
  key: string;
  label: string;
  /** Leading mark: a type glyph, a site mark, a tag swatch. */
  glyph?: ReactNode;
  count?: number;
}

/**
 * One chip, one menu. The same control filters the stream by kind, source or
 * tag and picks the kind in the composer, so every "choose one of N" surface
 * reads the same way: faint `name ▾` when unset, filled `glyph label ×` when
 * set. ↑/↓/↵ in the menu; Esc or click-outside closes.
 */
export function FacetMenu({
  name,
  value,
  options,
  onChange,
  clearable = true,
  align = "left",
  direction = "down",
}: {
  name: string;
  value: string | null;
  options: FacetOption[];
  onChange: (key: string | null) => void;
  /** When false, there is no "any" row and no × — the composer's kind picker. */
  clearable?: boolean;
  align?: "left" | "right";
  direction?: "down" | "up";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.key === value) ?? null;
  const rows: (FacetOption | null)[] = clearable ? [null, ...options] : options;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex((o) => (o?.key ?? null) === value)));
    function onDown(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // `rows` is rebuilt each render; only the open transition should reseed.
  }, [open]);

  function pick(row: FacetOption | null) {
    onChange(row?.key ?? null);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(rows[active] ?? null);
    }
  }

  return (
    <div ref={root} className="relative flex-none font-mono text-[12px]" onKeyDown={onKeyDown}>
      <div
        className={`flex h-7 items-center rounded-full border transition-colors ${
          selected ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-faint hover:border-line-2 hover:text-ink"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex h-full items-center gap-1.5 pl-2.5 ${selected && clearable ? "pr-1" : "pr-2.5"}`}
        >
          {selected ? (
            <>
              {selected.glyph && <span className="flex-none">{selected.glyph}</span>}
              <span className="max-w-[12rem] truncate">{selected.label}</span>
            </>
          ) : (
            <>
              <span>{name}</span>
              <span className="text-ink-faint">▾</span>
            </>
          )}
        </button>
        {selected && clearable && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`clear ${name}`}
            className="grid h-full w-6 place-items-center rounded-r-full text-ink-faint hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          role="listbox"
          aria-label={name}
          className={`absolute z-30 min-w-[13rem] max-w-[20rem] overflow-hidden rounded-lg border border-line-2 bg-surface-2 p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)] ${
            direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {rows.map((row, i) => {
            const isActive = i === active;
            const isSelected = (row?.key ?? null) === value;
            return (
              <li key={row?.key ?? "*"} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${
                    isActive ? "bg-accent/10 text-accent" : isSelected ? "text-ink" : "text-ink-dim"
                  }`}
                >
                  <span className="grid w-5 flex-none place-items-center">{row ? row.glyph : "∗"}</span>
                  <span className="min-w-0 flex-1 truncate">{row ? row.label : `any ${name}`}</span>
                  {row?.count !== undefined && (
                    <span className="flex-none tabular-nums text-ink-faint">{row.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
