"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { emitCardChanged, onCardChanged } from "@/lib/card-events";

interface TagRow {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

/**
 * Every tag with its card count. Rename edits the tag itself, so it applies
 * to every card carrying it; renaming onto another tag's name merges the two
 * (the row says so before you commit). Delete detaches from all cards and
 * asks once.
 */
export function TagManager() {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/tags").catch(() => null);
    if (!res?.ok) return;
    const data: { tags: TagRow[] } = await res.json();
    setTags(data.tags);
  }, []);

  useEffect(() => {
    void load();
    return onCardChanged(() => void load());
  }, [load]);

  async function write(path: string, init: RequestInit, failure: string): Promise<boolean> {
    setError(null);
    const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init }).catch(() => null);
    if (!res?.ok) {
      setError(failure);
      return false;
    }
    emitCardChanged();
    return true;
  }

  async function rename(tag: TagRow, name: string) {
    setEditing(null);
    if (!name || name === tag.name) return;
    await write(`/api/tags/${tag.id}`, { method: "PATCH", body: JSON.stringify({ name }) }, `couldn't rename #${tag.name}`);
  }

  async function remove(tag: TagRow) {
    setConfirming(null);
    await write(`/api/tags/${tag.id}`, { method: "DELETE" }, `couldn't delete #${tag.name}`);
  }

  async function create() {
    const name = draft.trim();
    if (!name) return;
    if (await write("/api/tags", { method: "POST", body: JSON.stringify({ name }) }, `couldn't create #${name}`)) {
      setDraft("");
    }
  }

  if (tags === null) return <p className="font-mono text-[11px] text-ink-faint">loading…</p>;

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="mb-4 flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new tag"
          aria-label="new tag"
          className="flex-1 rounded-md border border-line bg-inset px-3 py-1.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-2"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-inset transition disabled:bg-surface-2 disabled:text-ink-faint"
        >
          add
        </button>
      </form>

      {error && <p className="mb-3 font-mono text-[11px] text-red">{error}</p>}

      {tags.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-faint">no tags yet — add one above or from any card</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface font-mono text-[12px]">
          {tags.map((tag) => {
            const isEditing = editing?.id === tag.id;
            const into = isEditing
              ? tags.find((t) => t.id !== tag.id && t.name.toLowerCase() === editing.name.trim().toLowerCase())
              : undefined;
            return (
              <li key={tag.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: tag.color ?? "var(--color-ink-faint)" }}
                />
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-ink-faint">#</span>
                    <input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void rename(tag, editing.name.trim());
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                      onBlur={() => setEditing(null)}
                      aria-label={`rename ${tag.name}`}
                      className="min-w-0 flex-1 rounded border border-line-2 bg-inset px-2 py-0.5 text-ink outline-none focus:border-accent/60"
                    />
                    {into && <span className="flex-none text-amber">merges into #{into.name}</span>}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing({ id: tag.id, name: tag.name })}
                    title="rename"
                    className="min-w-0 flex-1 truncate text-left text-ink hover:text-accent"
                  >
                    #{tag.name}
                  </button>
                )}
                <Link
                  href={`/?scope=library&tag=${tag.id}`}
                  className="flex-none tabular-nums text-ink-faint hover:text-ink"
                  title="show cards"
                >
                  {tag.count} {tag.count === 1 ? "card" : "cards"}
                </Link>
                {confirming === tag.id ? (
                  <span className="flex flex-none items-center gap-2">
                    <button type="button" onClick={() => void remove(tag)} className="text-red hover:underline">
                      delete
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="text-ink-faint hover:text-ink">
                      keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(tag.id)}
                    aria-label={`delete ${tag.name}`}
                    className="flex-none text-ink-faint hover:text-red"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
