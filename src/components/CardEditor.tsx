"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CardDetail } from "@/lib/cards";
import { uploadFile } from "@/lib/upload-client";
import { CARD_STYLE } from "./card-style";

const TYPES = Object.keys(CARD_STYLE);

export function CardEditor({ detail }: { detail: CardDetail }) {
  const router = useRouter();
  const { card } = detail;
  const [type, setType] = useState(card.type);
  const [title, setTitle] = useState(card.title ?? "");
  const [body, setBody] = useState(card.body ?? "");
  const [url, setUrl] = useState(card.url ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    if (!el) {
      setBody((b) => b + text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setBody((b) => b.slice(0, start) + text + b.slice(end));
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const id = await uploadFile(file);
        insertAtCursor(`\n![${file.name}](file:${id})\n`);
      }
    } finally {
      setUploading(false);
    }
  }

  const dirty =
    type !== card.type ||
    title !== (card.title ?? "") ||
    body !== (card.body ?? "") ||
    url !== (card.url ?? "");

  async function save() {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        title: title || null,
        body: body || null,
        url: url || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm("Move this card to trash?")) return;
    await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-line bg-base px-2 py-1 text-sm text-ink-dim outline-none"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {CARD_STYLE[t]!.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-dim hover:text-ink disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Attach"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="ml-auto flex items-center gap-3">
          {savedAt && !dirty && (
            <span className="text-xs text-ink-faint">saved {savedAt}</span>
          )}
          <button
            onClick={() => void save()}
            disabled={!dirty || busy}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-base transition-opacity disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => void remove()}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-faint hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full bg-transparent font-serif text-2xl text-ink outline-none placeholder:text-ink-faint"
      />

      {(type === "link" || type === "video") && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-md border border-line bg-base px-3 py-2 text-sm text-sky-300 outline-none"
        />
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
        placeholder="Write in markdown… (drag images in, or Attach)"
        rows={16}
        className="w-full resize-y rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint"
      />
    </div>
  );
}
