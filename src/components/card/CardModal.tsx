"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CardEditor } from "@/components/CardEditor";
import { fmtBytes } from "@/components/brain/item";
import { Kbd, PdfStack, Waveform, fileUrl, heroOf, isTyping, useToast } from "@/components/brain/parts";
import { TagPicker } from "@/components/TagPicker";
import { styleFor } from "@/components/card-style";
import { emitCardChanged, onCardChanged } from "@/lib/card-events";
import { cardParam, closeCard } from "@/lib/card-url";
import type { CardDetail, CardTag } from "@/lib/cards";
import { relativeTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { sourceOf } from "@/lib/source";
import { BoardPicker } from "./BoardPicker";
import { RelationEditor } from "./RelationEditor";

type Card = CardDetail["card"];

/** Detail modal driven by `?card=<id>`; mount once per page that lists cards. */
export function CardModal() {
  return (
    <Suspense fallback={null}>
      <CardModalRoute />
    </Suspense>
  );
}

function CardModalRoute() {
  const params = useSearchParams();
  const id = cardParam(new URLSearchParams(params.toString()));
  if (!id) return null;
  return <CardModalPanel key={id} id={id} />;
}

function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
        {label}
        <span className="h-px flex-1 bg-line" />
        {action}
      </h3>
      {children}
    </section>
  );
}

function sourceRows(card: Card): Array<[string, ReactNode]> {
  const s = sourceOf(card);
  const rows: Array<[string, ReactNode]> = [];
  switch (s.via) {
    case "typed":
      rows.push(["via", "typed"]);
      break;
    case "web":
      rows.push(["via", "web"], ["site", s.domain]);
      break;
    case "share":
      rows.push(["via", "share sheet"]);
      if (s.app) rows.push(["app", s.app]);
      break;
    case "upload":
      rows.push(["via", "upload"], ["file", s.filename]);
      break;
    case "book":
      rows.push(["via", "book"]);
      if (s.work) rows.push(["book", s.work]);
      if (s.author) rows.push(["author", s.author]);
      if (s.page) rows.push(["page", s.page]);
      break;
  }
  if (card.url) {
    rows.push([
      "url",
      <a key="url" href={card.url} target="_blank" rel="noreferrer" className="break-all text-cyan hover:underline">
        {card.url.replace(/^https?:\/\//, "")}
      </a>,
    ]);
  }
  const d = new Date(card.createdAt);
  rows.push([
    "captured",
    d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  ]);
  return rows;
}

function Hero({ detail }: { detail: CardDetail }) {
  const { card, files } = detail;
  const hero = heroOf({ ...card, files });
  if (!hero) return null;
  switch (hero.kind) {
    case "image":
      // Images embedded in the body render in place via the markdown below.
      if (card.body?.includes(`file:${hero.fileId}`)) return null;
      return (
        <a href={fileUrl(hero.fileId, "original")} target="_blank" rel="noreferrer" className="mt-4 block">
          <img
            src={fileUrl(hero.fileId, "thumb-1200")}
            alt=""
            className="w-full rounded-md object-cover ring-1 ring-line"
            style={hero.w && hero.h ? { aspectRatio: `${hero.w} / ${hero.h}` } : undefined}
          />
        </a>
      );
    case "og":
      return (
        <a href={card.url ?? fileUrl(hero.fileId, "original")} target="_blank" rel="noreferrer" className="mt-4 block">
          <img src={fileUrl(hero.fileId, "thumb-1200")} alt="" className="w-full rounded-md object-cover ring-1 ring-line" />
        </a>
      );
    case "pdf":
      return (
        <div className="mt-4 flex items-end gap-5">
          <PdfStack className="w-28" />
          <div className="pb-1 font-mono text-[11px] text-ink-faint">
            <div className="text-ink">PDF document</div>
            <div>{fmtBytes(hero.bytes)}</div>
            <a
              href={fileUrl(hero.fileId, "original")}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-accent hover:underline"
            >
              open ↗
            </a>
          </div>
        </div>
      );
    case "audio":
      return (
        <div className="mt-4 rounded-lg bg-surface px-3 py-3">
          <Waveform seed={hero.fileId} bars={56} className="h-9 w-full" />
          <audio controls preload="metadata" src={fileUrl(hero.fileId, "original")} className="mt-2 w-full" />
        </div>
      );
  }
}

function CardModalPanel({ id }: { id: string }) {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const { show: showToast, node: toastNode } = useToast();

  const load = useCallback(async () => {
    const res = await fetch(`/api/cards/${id}`).catch(() => null);
    if (!res?.ok) {
      setMissing(true);
      return;
    }
    setDetail((await res.json()) as CardDetail);
  }, [id]);

  useEffect(() => {
    void load();
    return onCardChanged((changed) => {
      if (!changed || changed === id) void load();
    });
  }, [id, load]);

  // Optimistic; the reload after `emitCardChanged` reconciles (and reverts a failed write).
  async function setTag(tag: CardTag, action: "attach" | "detach") {
    setDetail((d) =>
      d && { ...d, tags: action === "attach" ? [...d.tags, tag] : d.tags.filter((t) => t.id !== tag.id) },
    );
    await fetch(`/api/cards/${id}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagId: tag.id, action }),
    }).catch(() => null);
    emitCardChanged(id);
  }

  // Lock page scroll behind the modal and move focus into it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const untriaged = detail !== null && detail.card.triagedAt == null;

  const archive = useCallback(async () => {
    if (!detail || detail.card.triagedAt != null) return;
    const before = detail;
    setDetail({ ...detail, card: { ...detail.card, triagedAt: new Date() } });
    const res = await fetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ triaged: true }),
    }).catch(() => null);
    if (!res?.ok) {
      setDetail(before);
      showToast("couldn't archive");
      return;
    }
    emitCardChanged(id);
    showToast("archived to library");
  }, [detail, id, showToast]);

  const focusTags = useCallback(() => {
    tagInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    tagInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        else if (picking) setPicking(false);
        else closeCard();
        return;
      }
      if (editing || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !detail) return;
      if (e.key === "e" && untriaged) {
        e.preventDefault();
        void archive();
      } else if (e.key === "b") {
        e.preventDefault();
        setPicking(true);
      } else if (e.key === "t") {
        e.preventDefault();
        focusTags();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archive, detail, editing, focusTags, picking, untriaged]);

  const card = detail?.card;
  const style = styleFor(card?.type ?? "thought");
  const html = card && card.type !== "quote" ? renderMarkdown(card.body) : "";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-inset/80 p-4 backdrop-blur-sm transition-opacity duration-200 starting:opacity-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCard();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={card?.title ?? "Card"}
        tabIndex={-1}
        className="relative max-h-[90dvh] w-full max-w-[44rem] overflow-y-auto rounded-2xl border border-line bg-base px-6 pb-8 pt-4 shadow-2xl outline-none transition duration-200 ease-out starting:translate-y-3 starting:scale-[0.98] starting:opacity-0 sm:px-8"
      >
        <div className="sticky -top-4 z-10 -mx-6 mb-2 flex items-center justify-between bg-base/90 px-6 py-2 font-mono text-[11px] text-ink-faint backdrop-blur sm:-mx-8 sm:px-8">
          <button type="button" onClick={closeCard} className="hover:text-ink">
            ← close
          </button>
          {detail && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className={`rounded px-2 py-0.5 ${editing ? "bg-surface-2 text-ink" : "hover:text-ink"}`}
            >
              {editing ? "done" : "edit"}
            </button>
          )}
        </div>

        {missing && !detail && <p className="py-10 text-center font-mono text-[12px] text-ink-faint">card not found</p>}
        {!missing && !detail && <p className="py-10 text-center font-mono text-[12px] text-ink-faint">loading…</p>}

        {detail && card && editing && (
          <CardEditor key={String(card.updatedAt)} detail={detail} onSaved={() => setEditing(false)} />
        )}

        {detail && card && !editing && (
          <article>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-faint">
              <span className={style.text}>
                {style.glyph} {style.label.toLowerCase()}
              </span>
              <span>·</span>
              <span>{relativeTime(card.createdAt)}</span>
              {untriaged && (
                <span className="ml-auto flex items-center gap-1.5 text-accent">
                  <span className="size-1.5 rounded-full bg-accent" /> untriaged
                </span>
              )}
            </div>

            {card.title && (
              <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-ink">{card.title}</h2>
            )}

            {card.type === "quote" && card.body && (
              <blockquote className="relative mt-4 whitespace-pre-wrap pl-6 font-display text-2xl font-semibold leading-snug tracking-tight text-ink">
                <span className="absolute -left-1 -top-3 font-display text-5xl text-accent">“</span>
                {card.body}
              </blockquote>
            )}

            <Hero detail={detail} />

            {html && <div className="prose-sb mt-4" dangerouslySetInnerHTML={{ __html: html }} />}

            {untriaged && (
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-line-2 px-3 py-2.5 font-mono text-[11px] text-ink-faint">
                <button type="button" onClick={() => void archive()} className="flex items-center gap-1.5 hover:text-ink">
                  <Kbd>e</Kbd> archive
                </button>
                <button type="button" onClick={() => setPicking(true)} className="flex items-center gap-1.5 hover:text-ink">
                  <Kbd>b</Kbd> file to board
                </button>
                <button type="button" onClick={focusTags} className="flex items-center gap-1.5 hover:text-ink">
                  <Kbd>t</Kbd> tag
                </button>
              </div>
            )}

            <Section label="Source">
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 font-mono text-[12px]">
                {sourceRows(card).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-faint">{k}</dt>
                    <dd className="text-ink-dim">{v}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            {detail.files.length > 0 && (
              <Section label={`Assets · ${detail.files.length}`}>
                <ul className="-mx-2">
                  {detail.files.map((f) => (
                    <li key={f.id} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] text-ink">
                          {f.mime} · {f.role}
                        </span>
                        <span className="block font-mono text-[10px] text-ink-faint">
                          {fmtBytes(f.bytes)}
                          {f.width && f.height ? ` · ${f.width}×${f.height}` : ""}
                        </span>
                      </span>
                      <a
                        href={fileUrl(f.id, "original")}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-ink-faint opacity-0 transition hover:text-ink group-hover:opacity-100 focus:opacity-100"
                      >
                        download ↓
                      </a>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section
              label="Filed"
              action={
                !picking && (
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="normal-case tracking-normal text-ink-faint hover:text-ink"
                  >
                    + board
                  </button>
                )
              }
            >
              {card.type === "board" && (
                <Link
                  href={`/boards/${card.id}`}
                  className="mb-3 inline-block rounded border border-accent/30 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/10"
                >
                  open board →
                </Link>
              )}
              {detail.boards.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5 font-mono text-[11px]">
                  {detail.boards.map((b) => (
                    <Link
                      key={b.id}
                      href={`/boards/${b.id}`}
                      className="rounded border border-accent/30 px-2 py-0.5 text-accent hover:bg-accent/10"
                    >
                      ⊞ {b.title ?? "Untitled"}
                    </Link>
                  ))}
                </div>
              )}
              {picking && (
                <div className="mb-3">
                  <BoardPicker
                    cardId={card.id}
                    exclude={detail.boards.map((b) => b.id)}
                    onClose={() => setPicking(false)}
                    onPlaced={(board) => {
                      setPicking(false);
                      emitCardChanged(id);
                      showToast(`filed to ${board.title ?? "board"}`);
                    }}
                  />
                </div>
              )}
              <TagPicker
                value={detail.tags}
                onAdd={(tag) => void setTag(tag, "attach")}
                onRemove={(tag) => void setTag(tag, "detach")}
                inputRef={tagInputRef}
              />
            </Section>

            <Section label="Links">
              <RelationEditor cardId={card.id} links={detail.links} backlinks={detail.backlinks} />
            </Section>
          </article>
        )}
      </div>
      {toastNode}
    </div>
  );
}
