"use client";

import { useEffect, useRef, useState } from "react";
import { styleFor } from "@/components/card-style";
import { emitCardChanged } from "@/lib/card-events";
import { openCard } from "@/lib/card-url";
import type { RelatedCard } from "@/lib/cards";

type Direction = "out" | "in";

interface Target {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
}

interface FormState {
  editing: boolean;
  dir: Direction;
  target: Target | null;
  label: string;
  description: string;
}

const EMPTY_FORM: FormState = { editing: false, dir: "out", target: null, label: "", description: "" };

function nameOf(c: { title: string | null; body: string | null }): string {
  if (c.title) return c.title;
  const s = (c.body ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Untitled";
  return s.length > 70 ? s.slice(0, 70) + "…" : s;
}

function Glyph({ type }: { type: string }) {
  const style = styleFor(type);
  return (
    <span className={`w-4 flex-none text-center font-mono text-sm ${style.text}`}>{style.glyph}</span>
  );
}

/** Quick-search for a link target; never offers the card itself. */
function TargetSearch({ selfId, onPick }: { selfId: string; onPick: (t: Target) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Target[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?mode=quick&q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { hits: Target[] };
        setHits(data.hits.filter((h) => h.id !== selfId).slice(0, 8));
        setActive(0);
      } catch {
        // aborted or offline: keep previous hits
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, selfId]);

  return (
    <div>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const h = hits[active];
            if (h) onPick(h);
          }
        }}
        placeholder="Find a card to link…"
        className="w-full rounded-md bg-base px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint"
      />
      {hits.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(h)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] ${
                  i === active ? "bg-surface-2 text-ink" : "text-ink-dim"
                }`}
              >
                <Glyph type={h.type} />
                <span className="truncate">{nameOf(h)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Card-to-card relations. Outgoing rows read "→ label", incoming "← label";
 * both directions can be created and edited from here. Writes are optimistic
 * and roll back if the server refuses.
 */
export function RelationEditor({
  cardId,
  links,
  backlinks,
}: {
  cardId: string;
  links: RelatedCard[];
  backlinks: RelatedCard[];
}) {
  const [outgoing, setOutgoing] = useState(links);
  const [incoming, setIncoming] = useState(backlinks);
  const [form, setForm] = useState<FormState | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Server data wins whenever the parent refetches the detail.
  useEffect(() => setOutgoing(links), [links]);
  useEffect(() => setIncoming(backlinks), [backlinks]);
  const formOpen = form !== null;
  useEffect(() => {
    if (!formOpen) return;
    const ctrl = new AbortController();
    fetch("/api/edges/labels", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { labels: [] }))
      .then((d: { labels: string[] }) => setLabels(d.labels))
      .catch(() => {});
    return () => ctrl.abort();
  }, [formOpen]);

  const datalistId = `edge-labels-${cardId}`;

  function endpoints(dir: Direction, targetId: string) {
    return dir === "out" ? { fromCard: cardId, toCard: targetId } : { fromCard: targetId, toCard: cardId };
  }

  async function save() {
    if (!form?.target) return;
    const { dir, target } = form;
    if (target.id === cardId) {
      setError("A card can't link to itself");
      return;
    }
    const label = form.label.trim() || null;
    const description = form.description.trim() || null;
    const row: RelatedCard = { ...target, label, description };
    const setList = dir === "out" ? setOutgoing : setIncoming;
    const prevOut = outgoing;
    const prevIn = incoming;
    setList((list) => {
      const i = list.findIndex((r) => r.id === target.id);
      if (i === -1) return [...list, row];
      const next = list.slice();
      next[i] = row;
      return next;
    });
    setForm(null);
    setError(null);
    const res = await fetch("/api/edges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...endpoints(dir, target.id), label, description }),
    }).catch(() => null);
    if (!res?.ok) {
      setOutgoing(prevOut);
      setIncoming(prevIn);
      setError("Couldn't save link");
      return;
    }
    emitCardChanged(cardId);
  }

  async function remove(dir: Direction, rel: RelatedCard) {
    const prevOut = outgoing;
    const prevIn = incoming;
    (dir === "out" ? setOutgoing : setIncoming)((list) => list.filter((r) => r.id !== rel.id));
    setError(null);
    const res = await fetch("/api/edges", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(endpoints(dir, rel.id)),
    }).catch(() => null);
    if (!res?.ok) {
      setOutgoing(prevOut);
      setIncoming(prevIn);
      setError("Couldn't remove link");
      return;
    }
    emitCardChanged(cardId);
  }

  function edit(dir: Direction, rel: RelatedCard) {
    setError(null);
    setForm({
      editing: true,
      dir,
      target: { id: rel.id, type: rel.type, title: rel.title, body: rel.body },
      label: rel.label ?? "",
      description: rel.description ?? "",
    });
  }

  const rows: Array<[Direction, RelatedCard]> = [
    ...outgoing.map((r) => ["out", r] as [Direction, RelatedCard]),
    ...incoming.map((r) => ["in", r] as [Direction, RelatedCard]),
  ];

  return (
    <div>
      {rows.length > 0 && (
        <ul className="-mx-2">
          {rows.map(([dir, rel]) => (
            <li key={`${dir}:${rel.id}`} className="group flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface">
              <span className="w-4 flex-none pt-0.5 text-center font-mono text-[12px] text-ink-faint">
                {dir === "out" ? "→" : "←"}
              </span>
              <Glyph type={rel.type} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openCard(rel.id)}
                    className="min-w-0 truncate text-left text-[13px] text-ink-dim hover:text-ink"
                  >
                    {nameOf(rel)}
                  </button>
                  {rel.label && (
                    <span className="flex-none rounded border border-line-2 px-1.5 font-mono text-[10px] text-ink-faint">
                      {rel.label}
                    </span>
                  )}
                </div>
                {rel.description && <p className="mt-0.5 text-[12px] leading-snug text-ink-faint">{rel.description}</p>}
              </div>
              <span className="flex flex-none gap-2 font-mono text-[10px] text-ink-faint opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button type="button" onClick={() => edit(dir, rel)} className="hover:text-ink">
                  edit
                </button>
                <button type="button" onClick={() => void remove(dir, rel)} className="hover:text-red">
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}

      {form ? (
        <div className="mt-2 rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 flex items-center gap-1 font-mono text-[11px]">
            {(["out", "in"] as const).map((d) => (
              <button
                key={d}
                type="button"
                disabled={form.editing}
                onClick={() => setForm({ ...form, dir: d })}
                className={`rounded px-2 py-0.5 disabled:cursor-not-allowed ${
                  form.dir === d ? "bg-surface-2 text-ink" : "text-ink-faint hover:text-ink-dim"
                }`}
              >
                {d === "out" ? "this → target" : "target → this"}
              </button>
            ))}
          </div>

          {form.target ? (
            <div className="flex items-center gap-2 rounded-md bg-base px-2 py-1.5">
              <Glyph type={form.target.type} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{nameOf(form.target)}</span>
              {!form.editing && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, target: null })}
                  className="font-mono text-[10px] text-ink-faint hover:text-ink"
                >
                  change
                </button>
              )}
            </div>
          ) : (
            <TargetSearch selfId={cardId} onPick={(t) => setForm({ ...form, target: t })} />
          )}

          {form.target && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setForm(null);
                }
              }}
              className="mt-2 flex flex-col gap-2"
            >
              <input
                autoFocus
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                list={datalistId}
                placeholder="label (e.g. supports, contradicts, part of)"
                maxLength={64}
                className="w-full rounded-md bg-base px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint"
              />
              <datalist id={datalistId}>
                {labels.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void save();
                  }
                }}
                placeholder="How are they related? (optional)"
                rows={2}
                className="w-full resize-y rounded-md bg-base px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
              />
              <div className="flex justify-end gap-2 font-mono text-[11px]">
                <button type="button" onClick={() => setForm(null)} className="px-2 py-1 text-ink-faint hover:text-ink">
                  cancel
                </button>
                <button type="submit" className="rounded-md bg-accent px-3 py-1 font-bold text-inset">
                  {form.editing ? "save" : "link"}
                </button>
              </div>
            </form>
          )}
          {!form.target && (
            <div className="mt-2 flex justify-end font-mono text-[11px]">
              <button type="button" onClick={() => setForm(null)} className="px-2 py-1 text-ink-faint hover:text-ink">
                cancel
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setForm(EMPTY_FORM);
          }}
          className="mt-2 rounded border border-dashed border-line-2 px-2 py-0.5 font-mono text-[11px] text-ink-faint hover:text-ink"
        >
          + link
        </button>
      )}
    </div>
  );
}
