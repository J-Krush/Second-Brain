"use client";

import { useState } from "react";

/**
 * The board's "outer card": its own title and description, editable inline at
 * the top of the canvas. Saves on blur; the board is still just a card.
 */
export function BoardHeader({
  boardId,
  initialTitle,
  initialBody,
}: {
  boardId: string;
  initialTitle: string | null;
  initialBody: string | null;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [saved, setSaved] = useState<{ title: string; body: string }>({
    title: initialTitle ?? "",
    body: initialBody ?? "",
  });

  async function save() {
    if (title === saved.title && body === saved.body) return;
    const res = await fetch(`/api/cards/${boardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim() || null, body: body.trim() || null }),
    });
    if (res.ok) setSaved({ title, body });
  }

  return (
    <div className="border-b border-line px-6 py-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Untitled board"
        className="w-full bg-transparent font-display text-2xl font-bold tracking-tight text-ink outline-none placeholder:text-ink-faint"
      />
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="What is this board for?"
        className="mt-1 w-full bg-transparent text-sm text-ink-dim outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}
