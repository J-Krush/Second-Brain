"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { emitCardChanged } from "@/lib/card-events";

/**
 * The card's note (the user's take, separate from its content), edited in
 * place: click or `n` to edit, blur or ⌘↵ saves, Esc cancels. Optimistic, and
 * rolls back if the server refuses. `openRef` lets the modal hotkey open it.
 */
export function NoteEditor({
  cardId,
  note,
  openRef,
}: {
  cardId: string;
  note: string | null;
  openRef?: Ref<HTMLButtonElement>;
}) {
  const [saved, setSaved] = useState(note);
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const [error, setError] = useState<string | null>(null);
  // Esc unmounts the textarea; this keeps a blur fired on the way out from saving.
  const cancelled = useRef(false);

  // Server data wins whenever the parent refetches the detail.
  useEffect(() => setSaved(note), [note]);

  async function commit(value: string) {
    setDraft(null);
    const next = value.trim() || null;
    if (next === saved) return;
    const prev = saved;
    setSaved(next);
    setError(null);
    const res = await fetch(`/api/cards/${cardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setSaved(prev);
      setError("couldn't save note");
      return;
    }
    emitCardChanged(cardId);
  }

  if (draft !== null) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          cancelled.current = false;
          e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length);
        }}
        onBlur={() => {
          if (!cancelled.current) void commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelled.current = true;
            setDraft(null);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            cancelled.current = true;
            void commit(draft);
          }
        }}
        rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
        placeholder="Your take: why it matters, what you think, where it connects…"
        className="w-full resize-y rounded-md border-l-2 border-accent/60 bg-surface px-3 py-2 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
      />
    );
  }

  return (
    <div>
      {saved ? (
        <button
          ref={openRef}
          type="button"
          onClick={() => setDraft(saved)}
          className="block w-full whitespace-pre-line border-l-2 border-line-2 py-0.5 pl-3 text-left text-[14px] leading-relaxed text-ink-dim hover:border-ink-faint hover:text-ink"
        >
          {saved}
        </button>
      ) : (
        <button
          ref={openRef}
          type="button"
          onClick={() => setDraft("")}
          className="rounded border border-dashed border-line-2 px-2 py-0.5 font-mono text-[11px] text-ink-faint hover:text-ink"
        >
          + add your take
        </button>
      )}
      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}
    </div>
  );
}
