"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FileRef } from "@/lib/cards";
import { sourceLabel, type Source } from "@/lib/source";
import { INLINE_FILE_RE } from "./item";

/** FNV-1a; deterministic so server and client render identical "random" art. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Staggered entrance; capped so long lists don't trickle in forever. */
export function stagger(i: number): CSSProperties {
  return { "--i": Math.min(i, 16) } as CSSProperties;
}

/** Whether a key/paste event originated in an editable field. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export type FileVariant = "original" | "thumb-400" | "thumb-1200";

export function fileUrl(id: string, variant: FileVariant): string {
  return `/api/files/${id}/${variant}`;
}

export type Hero =
  | { kind: "image"; fileId: string; w: number | null; h: number | null }
  | { kind: "pdf"; fileId: string; bytes: number }
  | { kind: "audio"; fileId: string }
  | { kind: "og"; fileId: string }
  | null;

/**
 * The one visual that represents a card: the first inline image in body
 * order, else the link's OG image, else an attached PDF, else audio.
 */
export function heroOf(card: { type: string; body: string | null; url: string | null; props: unknown; files: FileRef[] }): Hero {
  const byId = new Map(card.files.map((f) => [f.id, f]));
  for (const m of (card.body ?? "").matchAll(INLINE_FILE_RE)) {
    const f = byId.get(m[1]!.toLowerCase());
    if (f?.mime.startsWith("image/")) return { kind: "image", fileId: f.id, w: f.width, h: f.height };
  }
  const og = (card.props as { og?: { image?: unknown } } | null)?.og?.image;
  if (typeof og === "string" && og) return { kind: "og", fileId: og };
  const pdf = card.files.find((f) => f.mime === "application/pdf");
  if (pdf) return { kind: "pdf", fileId: pdf.id, bytes: pdf.bytes };
  const audio = card.files.find((f) => f.mime.startsWith("audio/"));
  if (audio) return { kind: "audio", fileId: audio.id };
  const image = card.files.find((f) => f.role === "inline" && f.mime.startsWith("image/"));
  if (image) return { kind: "image", fileId: image.id, w: image.width, h: image.height };
  return null;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-[1.25rem] place-items-center rounded border border-line-2 bg-surface-2 px-1 font-mono text-[10px] leading-4 text-ink-dim">
      {children}
    </kbd>
  );
}

const TONES = ["bg-cyan/15 text-cyan", "bg-accent/15 text-accent", "bg-amber/15 text-amber", "bg-ember/15 text-ember"];

/** Favicon stand-in: a letter tile tinted from the domain, stable per site. */
export function SiteMark({ label, className = "size-5 text-[10px]" }: { label: string; className?: string }) {
  const tone = TONES[hash(label) % TONES.length];
  const letter = label.replace(/^(www|notes)\./, "").charAt(0) || "·";
  return (
    <span
      className={`inline-grid flex-none place-items-center rounded font-mono font-bold uppercase ${tone} ${className}`}
      aria-hidden
    >
      {letter}
    </span>
  );
}

/** One-line "where did this come from". */
export function Provenance({ source, className = "" }: { source: Source; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-ink-faint ${className}`}>
      {source.via === "web" ? (
        <SiteMark label={source.domain} className="size-3.5 text-[8px]" />
      ) : (
        <span className="text-ink-faint/70">↳</span>
      )}
      <span className="truncate">{sourceLabel(source)}</span>
    </span>
  );
}

export function Waveform({
  seed,
  bars = 48,
  played = 0,
  className = "h-8",
}: {
  seed: string;
  bars?: number;
  played?: number;
  className?: string;
}) {
  let h = hash(seed);
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const envelope = Math.sin((i / bars) * Math.PI) * 0.55 + 0.45;
    heights.push(Math.max(0.14, ((h % 1000) / 1000) * envelope));
  }
  return (
    <span className={`flex items-center gap-[2px] ${className}`} aria-hidden>
      {heights.map((v, i) => (
        <span
          key={i}
          className={`w-[2px] flex-none rounded-full ${i / bars < played ? "bg-ember" : "bg-ink-faint/45"}`}
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** A PDF rendered as paper: light page on a dark desk reads instantly as "document". */
export function PdfStack({ pages, className = "w-24" }: { pages?: number; className?: string }) {
  const lines = [92, 78, 88, 64, 90, 72, 84, 40];
  return (
    <span className={`relative block aspect-[3/4] flex-none ${className}`}>
      <span className="absolute inset-0 translate-x-[6%] translate-y-[4%] rotate-3 rounded-[3px] border border-line bg-surface-2" />
      <span className="absolute inset-0 translate-x-[3%] translate-y-[2%] rotate-[1.5deg] rounded-[3px] border border-line bg-[#c9cfd3]" />
      <span className="absolute inset-0 flex flex-col gap-[6%] rounded-[3px] bg-[#e8ecee] p-[12%] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.8)]">
        <span className="h-[7%] w-[55%] rounded-[1px] bg-[#0a0c0e]/70" />
        {lines.map((w, i) => (
          <span key={i} className="h-[3.5%] rounded-[1px] bg-[#0a0c0e]/20" style={{ width: `${w}%` }} />
        ))}
        <span className="absolute bottom-[6%] right-[8%] font-mono text-[8px] font-bold text-ember">
          PDF{pages ? `·${pages}p` : ""}
        </span>
      </span>
    </span>
  );
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = message ? (
    <div
      key={message}
      role="status"
      className="sb-toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line-2 bg-surface-2 px-4 py-2 font-mono text-[12px] text-ink shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]"
    >
      <span className="mr-2 text-accent">&gt;</span>
      {message}
    </div>
  ) : null;
  return { show, node };
}
