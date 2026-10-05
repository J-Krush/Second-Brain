"use client";

import { useState } from "react";
import { CARD_STYLE } from "@/components/card-style";
import { emitCardChanged } from "@/lib/card-events";
import type { CreatedCard } from "@/lib/capture-bus";
import type { Source } from "@/lib/source";
import { uploadFile } from "@/lib/upload-client";
import { FacetMenu, type FacetOption } from "./FacetMenu";
import { fmtBytes } from "./item";
import { Kbd, SiteMark } from "./parts";

const LEADING_URL_RE = /^(https?:\/\/\S+)\s*/;

const KIND_OPTIONS: FacetOption[] = Object.entries(CARD_STYLE).map(([key, s]) => ({
  key,
  label: s.label.toLowerCase(),
  glyph: <span className={s.text}>{s.glyph}</span>,
}));

export interface Draft {
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  props: Record<string, unknown>;
}

interface Uploaded {
  name: string;
  mime: string;
  fileId: string;
}

interface QuoteFields {
  author: string;
  work: string;
  page: string;
}

/**
 * Composer text → card payload. Rules, in order:
 * 1. First line `# Title` becomes the title (removed from the body).
 * 2. Quote mode: type `quote`, the rest is the quote, author/work/page go to
 *    `props.source = {via:"book"}`.
 * 3. Otherwise, if the rest starts with an http(s) URL: type `link`, that URL,
 *    body = whatever follows (or null).
 * 4. Attachments append `![name](file:<id>)` to the body. With no text at all,
 *    `props.source = {via:"upload", filename}` of the first file, a single file
 *    names the card, and an all-non-image upload is a `document`.
 * 5. An explicit `kind` (the picker) wins over every inferred type.
 * Returns null when there is nothing to capture.
 */
export function buildDraft(text: string, files: Uploaded[], quote: QuoteFields | null, kind: string | null = null): Draft | null {
  let rest = text.trim();
  let title: string | null = null;
  const firstLine = rest.split("\n", 1)[0]!;
  const heading = /^#\s+(.+)$/.exec(firstLine);
  if (heading) {
    title = heading[1]!.trim();
    rest = rest.slice(firstLine.length).trim();
  }

  let type = "thought";
  let url: string | null = null;
  const props: Record<string, unknown> = {};
  if (quote) {
    if (!rest) return null;
    type = "quote";
    const source: Extract<Source, { via: "book" }> = { via: "book" };
    if (quote.author.trim()) source.author = quote.author.trim();
    if (quote.work.trim()) source.work = quote.work.trim();
    if (quote.page.trim()) source.page = quote.page.trim();
    props.source = source;
  } else {
    const m = LEADING_URL_RE.exec(rest);
    if (m && URL.canParse(m[1]!)) {
      type = "link";
      url = m[1]!;
      rest = rest.slice(m[0].length).trim();
    }
  }

  const embeds = files.map((f) => `![${f.name.replace(/[[\]]/g, "")}](file:${f.fileId})`).join("\n");
  const body = [rest, embeds].filter(Boolean).join("\n\n") || null;
  if (!title && !body && !url) return null;

  if (!text.trim() && files.length > 0) {
    props.source = { via: "upload", filename: files[0]!.name } satisfies Source;
    if (files.length === 1) title = files[0]!.name;
    if (files.every((f) => !f.mime.startsWith("image/"))) type = "document";
  }
  if (kind) type = kind;
  return { type, title, body, url, props };
}

/** POST a draft; returns the new card and broadcasts the change. */
export async function postCard(draft: Draft): Promise<CreatedCard> {
  const res = await fetch("/api/cards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (res.status !== 201) throw new Error(`capture failed (${res.status})`);
  const { card } = (await res.json()) as { card: CreatedCard };
  emitCardChanged(card.id);
  return card;
}

/** Drop/paste path shared with the Desk: upload every file, then one card. */
export async function captureFiles(files: File[]): Promise<void> {
  const uploaded = await Promise.all(
    files.map(async (f) => ({ name: f.name, mime: f.type, fileId: await uploadFile(f) })),
  );
  const draft = buildDraft("", uploaded, null);
  if (draft) await postCard(draft);
}

interface Attachment {
  key: string;
  name: string;
  mime: string;
  bytes: number;
  fileId?: string;
  failed?: boolean;
}

/**
 * The capture form inside the ⌘J dialog: type, paste a link, attach or drop
 * files, or pick a kind explicitly (boards, projects, mantras). ⌘↵ captures;
 * the created card is handed to `onCaptured`, which decides what happens next.
 */
export function Composer({
  onToast,
  onCaptured,
}: {
  onToast: (msg: string) => void;
  onCaptured: (card: CreatedCard) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [quote, setQuote] = useState<QuoteFields | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const uploaded = files.filter((f): f is Attachment & { fileId: string } => !!f.fileId);
  const uploading = files.some((f) => !f.fileId && !f.failed);
  const preview = buildDraft(text, [], null);
  const host = preview?.url ? new URL(preview.url).hostname.replace(/^www\./, "") : null;
  const draft = buildDraft(text, uploaded, quote, kind);
  const ready = !busy && !uploading && draft !== null;
  // What the picker shows when nothing is forced: the inferred kind.
  const shownKind = kind ?? draft?.type ?? preview?.type ?? "thought";

  function addFiles(list: FileList | File[] | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const entries = picked.map((f) => ({ key: crypto.randomUUID(), name: f.name, mime: f.type, bytes: f.size }));
    setFiles((prev) => [...prev, ...entries]);
    picked.forEach((f, i) => {
      const key = entries[i]!.key;
      uploadFile(f).then(
        (fileId) => setFiles((prev) => prev.map((a) => (a.key === key ? { ...a, fileId } : a))),
        () => {
          setFiles((prev) => prev.map((a) => (a.key === key ? { ...a, failed: true } : a)));
          onToast(`upload failed · ${f.name}`);
        },
      );
    });
  }

  async function submit() {
    if (!draft || busy || uploading) return;
    setBusy(true);
    try {
      const card = await postCard(draft);
      setText("");
      setFiles([]);
      setQuote(null);
      setKind(null);
      onCaptured(card);
    } catch {
      onToast("capture failed");
    } finally {
      setBusy(false);
    }
  }

  const lines = text.split("\n").length;

  return (
    <div
      data-composer-drop
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(false);
        addFiles(e.dataTransfer.files);
      }}
      className={`relative rounded-xl border transition-colors ${over ? "border-dashed border-accent bg-accent/5" : "border-transparent"}`}
    >
      <div className="flex gap-3 px-4 pt-3">
        <span className="pt-0.5 font-mono text-accent">{quote ? "“" : ">"}</span>
        <textarea
          data-composer
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={Math.min(10, Math.max(3, lines))}
          placeholder={
            quote ? "The quote…" : "What's on your mind? Paste a link, drop a file, or just type. # Title on line one."
          }
          className="min-h-[1.75rem] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {quote && (
        <div className="sb-fade mx-4 mt-2 grid grid-cols-[1fr_1fr_5rem] gap-2 font-mono text-[12px]">
          {(["author", "work", "page"] as const).map((k) => (
            <input
              key={k}
              value={quote[k]}
              onChange={(e) => setQuote({ ...quote, [k]: e.target.value })}
              placeholder={k}
              className="rounded-md border border-line bg-inset px-2.5 py-1.5 text-ink outline-none placeholder:text-ink-faint focus:border-line-2"
            />
          ))}
        </div>
      )}

      {host && !quote && (
        <div className="sb-fade mx-4 mt-2 flex items-center gap-2.5 rounded-md bg-inset px-3 py-2">
          <SiteMark label={host} />
          <span className="font-mono text-[11px] text-ink-dim">{host}</span>
          <span className="font-mono text-[11px] text-ink-faint">· will fetch title, preview image &amp; text</span>
        </div>
      )}

      {files.length > 0 && (
        <ul className="mx-4 mt-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <li
              key={f.key}
              className={`sb-fade flex items-center gap-2 rounded-md border bg-inset py-1 pl-2 pr-1 font-mono text-[11px] ${
                f.failed ? "border-red/50 text-red" : "border-line-2 text-ink-dim"
              }`}
            >
              <span className="text-amber">
                {f.mime.startsWith("image/") ? "▣" : f.mime.startsWith("audio/") ? "◉" : "⎘"}
              </span>
              <span className="max-w-[14rem] truncate">{f.name}</span>
              <span className="text-ink-faint">
                {f.failed ? "failed" : f.fileId ? fmtBytes(f.bytes) : "uploading…"}
              </span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((a) => a.key !== f.key))}
                className="rounded px-1 text-ink-faint hover:bg-surface-2 hover:text-ink"
                aria-label={`remove ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-1 border-t border-line px-2 py-1.5 font-mono text-[11px] text-ink-faint">
        <label className="cursor-pointer rounded px-2 py-1 hover:bg-surface-2 hover:text-ink">
          ⎘ file
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="cursor-pointer rounded px-2 py-1 hover:bg-surface-2 hover:text-ink">
          ▣ photo
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          aria-pressed={!!quote}
          onClick={() => setQuote(quote ? null : { author: "", work: "", page: "" })}
          className={`rounded px-2 py-1 hover:bg-surface-2 ${quote ? "bg-accent/10 text-accent" : "hover:text-accent"}`}
        >
          “ quote
        </button>
        <FacetMenu
          name="kind"
          values={[shownKind]}
          multi={false}
          direction="up"
          options={KIND_OPTIONS}
          onChange={(keys) => setKind(keys[0] ?? null)}
        />
        <span className="ml-auto hidden items-center gap-1.5 sm:flex">
          {over ? (
            <span className="text-accent">release to attach</span>
          ) : (
            <>
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready}
          className="ml-2 rounded-md bg-accent px-3 py-1 font-bold uppercase tracking-widest text-inset transition disabled:bg-surface-2 disabled:text-ink-faint"
        >
          {busy ? "…" : "capture"}
        </button>
      </div>
    </div>
  );
}
