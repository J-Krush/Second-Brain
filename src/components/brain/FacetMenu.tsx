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
 * tag (multi: rows toggle, the menu stays open) and picks the kind in the
 * composer (single: picking closes). Faint `name ▾` when unset; filled
 * `glyph label ×` with one value, `name · N ×` with several. ↑/↓/↵/space in
 * the menu; Esc or click-outside closes.
 */
export function FacetMenu({
  name,
  values,
  options,
  onChange,
  multi = true,
  align = "left",
  direction = "down",
}: {
  name: string;
  values: string[];
  options: FacetOption[];
  onChange: (keys: string[]) => void;
  /** Single mode has no "any" row and no ×; picking replaces and closes. */
  multi?: boolean;
  align?: "left" | "right";
  direction?: "down" | "up";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.filter((o) => values.includes(o.key));
  const rows: (FacetOption | null)[] = multi ? [null, ...options] : options;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, rows.findIndex((o) => o !== null && values.includes(o.key))));
    function onDown(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // `rows` is rebuilt each render; only the open transition should reseed.
  }, [open]);

  function pick(row: FacetOption | null) {
    if (!multi) {
      onChange(row ? [row.key] : []);
      setOpen(false);
      return;
    }
    if (row === null) {
      onChange([]);
      setOpen(false);
      return;
    }
    onChange(values.includes(row.key) ? values.filter((k) => k !== row.key) : [...values, row.key]);
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
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(rows[active] ?? null);
    }
  }

  const one = selected.length === 1 ? selected[0]! : null;
  const filled = selected.length > 0;

  return (
    <div ref={root} className="relative flex-none font-mono text-[12px]" onKeyDown={onKeyDown}>
      <div
        className={`flex h-7 items-center rounded-full border transition-colors ${
          filled ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-faint hover:border-line-2 hover:text-ink"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex h-full items-center gap-1.5 pl-2.5 ${filled && multi ? "pr-1" : "pr-2.5"}`}
        >
          {one ? (
            <>
              {one.glyph && <span className="flex-none">{one.glyph}</span>}
              <span className="max-w-[12rem] truncate">{one.label}</span>
            </>
          ) : filled ? (
            <>
              <span>{name}</span>
              <span className="text-accent">· {selected.length}</span>
            </>
          ) : (
            <>
              <span>{name}</span>
              <span className="text-ink-faint">▾</span>
            </>
          )}
        </button>
        {filled && multi && (
          <button
            type="button"
            onClick={() => onChange([])}
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
          aria-multiselectable={multi}
          className={`absolute z-30 min-w-[13rem] max-w-[20rem] overflow-hidden rounded-lg border border-line-2 bg-surface-2 p-1 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)] ${
            direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {rows.map((row, i) => {
            const isActive = i === active;
            const isSelected = row === null ? values.length === 0 : values.includes(row.key);
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
                  {multi && row !== null && (
                    <span className={`w-3 flex-none text-center ${isSelected ? "text-accent" : "text-transparent"}`}>✓</span>
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
