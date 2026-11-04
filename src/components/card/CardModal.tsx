"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CardEditor } from "@/components/CardEditor";
import { TagEditor } from "@/components/TagEditor";
import { fmtBytes } from "@/components/brain/item";
import { Kbd, PdfStack, Waveform, fileUrl, heroOf, isTyping, useToast } from "@/components/brain/parts";
import { styleFor } from "@/components/card-style";
import { emitCardChanged, onCardChanged } from "@/lib/card-events";
import { cardParam, closeCard } from "@/lib/card-url";
import type { CardDetail } from "@/lib/cards";
import { fmtTimestamp, relativeTime } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { sourceOf } from "@/lib/source";
import { resumeUpload, transcribeUpload } from "@/lib/transcribe-client";
import { youtubeTimestampUrl, youtubeVideoId } from "@/lib/youtube";
import { BoardPicker } from "./BoardPicker";
import { RelationEditor } from "./RelationEditor";

interface TagRef {
  id: number;
  name: string;
  color: string | null;
}

type Card = CardDetail["card"];

/** Chunks sent so far by an upload transcript running in this modal; `total` is 0 while the file decodes. */
interface UploadProgress {
  done: number;
  total: number;
}

const TRANSCRIPT_POLL_MS = 2000;

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
          <audio
            controls
            preload="metadata"
            data-transcript-media
            src={fileUrl(hero.fileId, "original")}
            className="mt-2 w-full"
          />
        </div>
      );
    case "video":
      return (
        <video
          controls
          preload="metadata"
          data-transcript-media
          src={fileUrl(hero.fileId, "original")}
          className="mt-4 w-full rounded-md ring-1 ring-line"
        />
      );
  }
}

const ACTION_BUTTON = "normal-case tracking-normal text-ink-faint hover:text-ink disabled:opacity-50";
const PRIMARY_BUTTON =
  "rounded border border-accent/30 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50";
const START_CAPTIONS: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: "youtube" }),
};

/**
 * Transcript for a YouTube link (server-fetched captions) or an attached
 * audio/video file (decoded in the browser, transcribed chunk by chunk). Upload
 * progress lives in the panel so toggling edit mode mid-run doesn't offer a
 * duplicate "resume" while chunks are still being sent.
 */
function TranscriptSection({
  detail,
  upload,
  setUpload,
  reload,
  toast,
}: {
  detail: CardDetail;
  upload: UploadProgress | null;
  setUpload: (p: UploadProgress | null) => void;
  reload: () => Promise<void>;
  toast: (message: string) => void;
}) {
  const { card, files, transcript } = detail;
  const [busy, setBusy] = useState(false);
  const videoId = youtubeVideoId(card.url);
  const media = files.find((f) => f.mime.startsWith("audio/") || f.mime.startsWith("video/"));
  const polling =
    transcript?.source === "youtube" && (transcript.status === "pending" || transcript.status === "running");

  // Captions are fetched in the background after the POST returns; poll until the row settles.
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void reload(), TRANSCRIPT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, reload]);

  if (!videoId && !media) return null;

  async function request(init: RequestInit, failure: string) {
    setBusy(true);
    const res = await fetch(`/api/cards/${card.id}/transcribe`, init).catch(() => null);
    setBusy(false);
    if (!res?.ok) toast(failure);
    else emitCardChanged(card.id);
  }

  async function runUpload(fileId: string, haveSeqs: number[] | null) {
    setUpload({ done: 0, total: 0 });
    const onProgress = (done: number, total: number) => setUpload({ done, total });
    try {
      if (haveSeqs) await resumeUpload(card.id, fileId, haveSeqs, onProgress);
      else await transcribeUpload(card.id, fileId, onProgress);
    } catch (e) {
      toast(e instanceof Error ? e.message : "transcription failed");
    } finally {
      setUpload(null);
    }
  }

  const uploadFileId = transcript?.fileId ?? media?.id ?? null;
  const restart = () => {
    if (transcript?.source === "youtube") void request(START_CAPTIONS, "couldn't fetch captions");
    else if (uploadFileId) void runUpload(uploadFileId, null);
  };
  const working = busy || upload !== null || polling;

  function seek(startMs: number) {
    const el = document.querySelector<HTMLMediaElement>("[data-transcript-media]");
    if (el) {
      el.currentTime = startMs / 1000;
      el.play().catch(() => {});
    } else if (uploadFileId) {
      // The hero is an image when the body embeds one first; fall back to the file with a media fragment.
      window.open(`${fileUrl(uploadFileId, "original")}#t=${Math.floor(startMs / 1000)}`, "_blank", "noreferrer");
    }
  }

  let content: ReactNode;
  if (upload) {
    content = (
      <p className="font-mono text-[11px] text-ink-faint">
        {upload.total === 0 ? "decoding audio…" : `transcribing ${upload.done} / ${upload.total}`}
      </p>
    );
  } else if (!transcript) {
    content = (
      <div className="flex flex-wrap gap-2">
        {videoId && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void request(START_CAPTIONS, "couldn't fetch captions")}
            className={PRIMARY_BUTTON}
          >
            fetch captions
          </button>
        )}
        {media && (
          <button type="button" onClick={() => void runUpload(media.id, null)} className={PRIMARY_BUTTON}>
            transcribe audio
          </button>
        )}
      </div>
    );
  } else if (polling) {
    content = <p className="font-mono text-[11px] text-ink-faint">fetching captions…</p>;
  } else if (transcript.status === "running" || transcript.status === "pending") {
    // An upload transcript left running by an earlier session: the browser that was sending chunks is gone.
    content = (
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-ink-faint">
        <span>
          transcribed {transcript.chunks.length} / {transcript.totalChunks ?? "?"}
        </span>
        {uploadFileId && (
          <button
            type="button"
            onClick={() => void runUpload(uploadFileId, transcript.chunks.map((c) => c.seq))}
            className={PRIMARY_BUTTON}
          >
            resume
          </button>
        )}
      </div>
    );
  } else if (transcript.status === "unavailable") {
    content = <p className="font-mono text-[11px] text-ink-faint">no captions on this video</p>;
  } else if (transcript.status === "failed") {
    content = (
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
        <span className="text-red">{transcript.error ?? "transcription failed"}</span>
        <button type="button" disabled={busy} onClick={restart} className={PRIMARY_BUTTON}>
          retry
        </button>
      </div>
    );
  } else {
    content = (
      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-2">
        {transcript.chunks.map((c) => {
          const startMs = c.startMs;
          const stampClass = "mr-2 font-mono text-[11px] text-ink-faint hover:text-accent";
          return (
            <p key={c.seq} className="text-[14px] leading-relaxed text-ink-dim">
              {startMs !== null &&
                (transcript.source === "youtube" && videoId ? (
                  <a href={youtubeTimestampUrl(videoId, startMs)} target="_blank" rel="noreferrer" className={stampClass}>
                    {fmtTimestamp(startMs)}
                  </a>
                ) : (
                  <button type="button" onClick={() => seek(startMs)} className={stampClass}>
                    {fmtTimestamp(startMs)}
                  </button>
                ))}
              {c.text}
            </p>
          );
        })}
      </div>
    );
  }

  const terminal = transcript && !working && transcript.status !== "running" && transcript.status !== "pending";
  return (
    <Section
      label="Transcript"
      action={
        (terminal || (transcript?.source === "upload" && !working)) && (
          <span className="flex items-center gap-3">
            {transcript?.status === "done" && (
              <button type="button" onClick={restart} className={ACTION_BUTTON}>
                redo
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void request({ method: "DELETE" }, "couldn't remove transcript")}
              className={ACTION_BUTTON}
            >
              remove
            </button>
          </span>
        )
      }
    >
      {content}
    </Section>
  );
}

function CardModalPanel({ id }: { id: string }) {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [allTags, setAllTags] = useState<TagRef[]>([]);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const { show: showToast, node: toastNode } = useToast();
  const [upload, setUpload] = useState<UploadProgress | null>(null);

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

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/tags", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((d: { tags: TagRef[] }) => setAllTags(d.tags))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

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

            <TranscriptSection detail={detail} upload={upload} setUpload={setUpload} reload={load} toast={showToast} />

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
              <TagEditor key={card.id} cardId={card.id} attached={detail.tags} allTags={allTags} inputRef={tagInputRef} />
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
