"use client";

import { useMemo, useState, type Ref } from "react";
import { emitCardChanged } from "@/lib/card-events";

interface TagRef {
  id: number;
  name: string;
  color: string | null;
}

/**
 * Attach/detach tags on a card. Typing a new name creates the tag globally,
 * then attaches it. Renames/deletes of tags themselves live in the library.
 */
export function TagEditor({
  cardId,
  attached,
  allTags,
  inputRef,
}: {
  cardId: string;
  attached: TagRef[];
  allTags: TagRef[];
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [tags, setTags] = useState<TagRef[]>(attached);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const attachedIds = useMemo(
    () => new Set(tags.map((t) => t.id)),
    [tags],
  );
  const suggestions = allTags.filter(
    (t) =>
      !attachedIds.has(t.id) &&
      t.name.toLowerCase().includes(input.trim().toLowerCase()),
  );

  async function attach(tag: TagRef) {
    setInput("");
    setTags((prev) => [...prev, tag]);
    await fetch(`/api/cards/${cardId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: tag.id, action: "attach" }),
    });
    emitCardChanged(cardId);
  }

  async function detach(tag: TagRef) {
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
    await fetch(`/api/cards/${cardId}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: tag.id, action: "detach" }),
    });
    emitCardChanged(cardId);
  }

  async function createAndAttach() {
    const name = input.trim();
    if (!name || busy) return;
    const existing = allTags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return attach(existing);
    setBusy(true);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (res.ok) await attach((await res.json()).tag);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <span
          key={t.id}
          className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-dim"
          style={t.color ? { borderColor: t.color, color: t.color } : undefined}
        >
          {t.name}
          <button
            onClick={() => void detach(t)}
            className="text-ink-faint hover:text-red-400"
            aria-label={`Remove ${t.name}`}
          >
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createAndAttach();
            }
          }}
          placeholder="+ tag"
          className="w-24 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:w-40 focus:border-accent-dim"
        />
        {input.trim() && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-40 overflow-hidden rounded-md border border-line bg-surface-2 text-xs shadow-xl">
            {suggestions.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => void attach(t)}
                  className="block w-full px-3 py-1.5 text-left text-ink-dim hover:bg-surface hover:text-ink"
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
