"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CARD_STYLE } from "./card-style";

const TYPES = Object.keys(CARD_STYLE);

/**
 * Pinned quick-capture. Enter with Cmd/Ctrl submits; capture never requires a
 * title, tags, or a location. The global `c` hotkey focuses this box.
 */
export function CaptureBox() {
  const router = useRouter();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [type, setType] = useState("thought");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "c" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    // A link card's URL comes from the captured text.
    const isUrl = type === "link" && /^https?:\/\//i.test(body);
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        isUrl ? { type, url: body } : { type, body },
      ),
    });
    setBusy(false);
    if (res.ok) {
      setText("");
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-lg">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Capture a thought…  (⌘/Ctrl+Enter to save)"
        rows={2}
        className="w-full resize-none bg-transparent px-2 py-1 text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="mt-2 flex items-center gap-2">
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
          onClick={() => void submit()}
          disabled={busy || text.trim().length === 0}
          className="ml-auto rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-base transition-opacity disabled:opacity-40"
        >
          Capture
        </button>
      </div>
    </div>
  );
}
