"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  registerCaptureModal,
  type CaptureOptions,
} from "@/lib/capture-bus";
import { CARD_STYLE } from "./card-style";

const TYPES = Object.keys(CARD_STYLE);

// Which fields each type shows, what they're called, and what's required.
interface TypeForm {
  url?: { label: string; required: boolean };
  title?: { label: string; required: boolean };
  body?: { label: string; required: boolean };
  /** Field to autofocus. */
  focus: "url" | "title" | "body";
  /** Allow submitting with every field empty (boards). */
  allowEmpty?: boolean;
}

const FORMS: Record<string, TypeForm> = {
  thought: { body: { label: "What's on your mind…", required: true }, focus: "body" },
  quote: {
    body: { label: "The quote…", required: true },
    title: { label: "Source / attribution (optional)", required: false },
    focus: "body",
  },
  mantra: { body: { label: "The mantra…", required: true }, focus: "body" },
  link: {
    url: { label: "https://…", required: true },
    title: { label: "Title (optional — fetched from the page)", required: false },
    body: { label: "Why you saved it, your notes… (optional)", required: false },
    focus: "url",
  },
  video: {
    url: { label: "https://…", required: true },
    title: { label: "Title (optional)", required: false },
    body: { label: "What you got out of it… (optional)", required: false },
    focus: "url",
  },
  document: {
    title: { label: "Document title", required: true },
    body: { label: "Write in markdown…", required: false },
    focus: "title",
  },
  project: {
    title: { label: "Project name", required: true },
    body: { label: "What is this project? (optional)", required: false },
    focus: "title",
  },
  board: {
    title: { label: "Board name (optional)", required: false },
    body: { label: "What is this board for? (optional)", required: false },
    focus: "title",
    allowEmpty: true,
  },
};

export function CaptureModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<CaptureOptions>({});
  const [type, setType] = useState("thought");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const form = FORMS[type] ?? FORMS.thought!;

  const openModal = useCallback((options: CaptureOptions) => {
    setOpts(options);
    setType(options.defaultType ?? "thought");
    setTitle("");
    setBody("");
    setUrl("");
    setError(null);
    setOpen(true);
  }, []);

  useEffect(() => registerCaptureModal(openModal), [openModal]);

  // Global hotkey: c captures anywhere (unless typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "c" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const composer = document.querySelector<HTMLTextAreaElement>("[data-composer]");
        if (composer) composer.focus();
        else openModal({});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openModal]);

  // Focus the right field when opening or switching type.
  useEffect(() => {
    if (!open) return;
    const el =
      form.focus === "url" ? urlRef.current
      : form.focus === "title" ? titleRef.current
      : bodyRef.current;
    el?.focus();
  }, [open, type, form.focus]);

  const canSubmit =
    Boolean(form.allowEmpty) ||
    ((!form.url?.required || /^https?:\/\/\S+$/i.test(url.trim())) &&
      (!form.title?.required || title.trim().length > 0) &&
      (!form.body?.required || body.trim().length > 0) &&
      (title.trim() || body.trim() || url.trim()).length > 0);

  async function submit() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { type };
    if (form.title && title.trim()) payload.title = title.trim();
    if (form.body && body.trim()) payload.body = body.trim();
    if (form.url && url.trim()) payload.url = url.trim();
    if (type === "board" && !title.trim()) payload.title = "Untitled board";

    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "capture failed");
      return;
    }
    const { card } = await res.json();
    setOpen(false);

    if (opts.onCreated?.(card) === true) return;
    if (card.type === "board") {
      router.push(`/boards/${card.id}`);
    } else {
      router.refresh();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line-2 bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {/* Type picker */}
        <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                type === t
                  ? "bg-accent text-inset"
                  : "text-ink-faint hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {CARD_STYLE[t]!.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {form.url && (
            <input
              ref={urlRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={form.url.label}
              className="w-full rounded-lg border border-line bg-inset px-3 py-2.5 font-mono text-sm text-cyan outline-none placeholder:text-ink-faint focus:border-accent-dim"
            />
          )}
          {form.title && (
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={form.title.label}
              className="w-full bg-transparent font-display text-xl font-bold tracking-tight text-ink outline-none placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-ink-faint"
            />
          )}
          {form.body && (
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={form.body.label}
              rows={type === "thought" || type === "document" ? 5 : 3}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
            />
          )}
          {error && <p className="font-mono text-xs text-red">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            esc to close
          </span>
          <button
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
            className="rounded-lg bg-accent px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-inset transition-opacity disabled:opacity-30"
          >
            {busy ? "Saving…" : "Capture ⌘↵"}
          </button>
        </div>
      </div>
    </div>
  );
}
