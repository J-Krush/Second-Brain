"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { styleFor } from "@/components/card-style";
import { openCard } from "@/lib/card-url";
import { sourceOf } from "@/lib/source";
import { captureFiles, postCard } from "./Composer";
import { displayBody, headline, isQuote, type BrainCard } from "./item";
import { PdfStack, SiteMark, Waveform, fileUrl, heroOf, isTyping, stagger } from "./parts";

/**
 * A light table: each object at its natural shape inside a faint frame. The
 * whole page is a drop target and a paste target for links.
 */
export function Desk({ items, onToast }: { items: BrainCard[]; onToast: (msg: string) => void }) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    function capture(files: File[]) {
      if (files.length === 0) return;
      onToast(`uploading ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`);
      captureFiles(files).then(
        () => onToast(`captured ${files.length === 1 ? files[0]!.name : `${files.length} files`} → inbox`),
        () => onToast("capture failed"),
      );
    }
    function enter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    }
    function leave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    }
    function over(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault();
    }
    function drop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      // The composer attaches its own drops to the draft.
      if ((e.target as Element | null)?.closest?.("[data-composer-drop]")) return;
      capture(Array.from(e.dataTransfer?.files ?? []));
    }
    function paste(e: ClipboardEvent) {
      if (isTyping(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        capture(files);
        return;
      }
      const text = (e.clipboardData?.getData("text") ?? "").trim();
      if (!/^https?:\/\/\S+$/.test(text) || !URL.canParse(text)) return;
      e.preventDefault();
      const host = new URL(text).hostname.replace(/^www\./, "");
      postCard({ type: "link", title: null, body: null, url: text, props: {} }).then(
        () => onToast(`clipping ${host} → inbox`),
        () => onToast("capture failed"),
      );
    }
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [onToast]);

  return (
    <div>
      <p className="mt-6 font-mono text-[11px] text-ink-faint">
        drop anything on the page · paste a link · click to inspect
      </p>

      <div className="mt-6 columns-1 gap-6 sm:columns-2 lg:columns-3 2xl:columns-4">
        {items.map((card, i) => {
          const style = styleFor(card.type);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => (card.type === "board" ? router.push(`/boards/${card.id}`) : openCard(card.id))}
              style={stagger(i)}
              className="sb-rise group mb-6 block w-full break-inside-avoid rounded-lg border border-line bg-surface/40 p-4 text-left outline-none transition-colors hover:border-line-2 focus-visible:border-accent/60"
            >
              <Tile card={card} />
              {card.note && (
                <p className="mt-3 line-clamp-3 whitespace-pre-line border-l-2 border-line-2 pl-2.5 text-[13px] leading-relaxed text-ink-dim">
                  {card.note}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className={`font-mono text-[11px] ${style.text}`}>
                  {style.glyph} {style.label.toLowerCase()}
                </span>
                {card.triagedAt === null && (
                  <span className="ml-auto size-1.5 flex-none rounded-full bg-accent" aria-label="untriaged" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {dragging && (
        <div className="sb-fade pointer-events-none fixed inset-0 z-50 grid place-items-center bg-inset/85 p-6 backdrop-blur-sm">
          <div className="sb-ants grid h-full w-full place-items-center rounded-3xl">
            <div className="text-center">
              <p className="font-display text-6xl font-extrabold tracking-tighter text-ink">
                <span className="text-accent">&gt;</span> drop to capture
              </p>
              <ul className="mt-6 space-y-1.5 font-mono text-[12px] text-ink-faint">
                <li>
                  <span className="text-amber">▣</span> images → embedded in a new note
                </li>
                <li>
                  <span className="text-ink">⎘</span> PDFs &amp; files → a document card
                </li>
                <li>
                  <span className="text-accent">→</span> lands in Inbox for triage
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ card }: { card: BrainCard }) {
  const hero = heroOf(card);
  const body = displayBody(card);

  if (isQuote(card.type)) {
    const source = sourceOf(card);
    return (
      <blockquote className={`border-t-2 pt-4 ${card.type === "mantra" ? "border-amber" : "border-accent"}`}>
        <p className="line-clamp-[8] whitespace-pre-line font-display text-[22px] font-semibold leading-[1.25] tracking-tight text-ink">
          {body || card.title}
        </p>
        {source.via === "book" && (source.author || source.work) && (
          <footer className="mt-3 text-[12px] text-ink-faint">
            — {source.author}
            {source.author && source.work && ", "}
            {source.work && <span className="italic">{source.work}</span>}
          </footer>
        )}
      </blockquote>
    );
  }

  if (card.type === "link" || card.type === "video") {
    const domain = card.url ? new URL(card.url).hostname.replace(/^www\./, "") : "";
    const image = hero?.kind === "og" || hero?.kind === "image" ? hero.fileId : null;
    return (
      <div>
        {image ? (
          <span className="relative block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(image, "thumb-400")}
              alt=""
              loading="lazy"
              className="aspect-[1.9] w-full rounded-md object-cover transition group-hover:brightness-110"
            />
            {card.type === "video" && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-12 place-items-center rounded-full bg-base/70 text-ink ring-1 ring-ink/20 backdrop-blur transition group-hover:scale-110">
                  ▶
                </span>
              </span>
            )}
          </span>
        ) : (
          <span className="grid aspect-[1.9] place-items-center rounded-md bg-gradient-to-br from-cyan/15 via-surface to-base">
            <SiteMark label={domain} className="size-14 text-2xl" />
          </span>
        )}
        <h3 className="mt-3 font-display text-[17px] font-bold leading-snug tracking-tight text-ink group-hover:text-cyan">
          {card.title ?? domain}
        </h3>
        {body && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-faint">{body}</p>}
      </div>
    );
  }

  if (card.type === "board") {
    return (
      <div className="relative pt-3">
        <span className="absolute inset-x-3 top-0 h-6 rounded-t-lg border border-b-0 border-line bg-surface/50" />
        <span className="absolute inset-x-1.5 top-1.5 h-6 rounded-t-lg border border-b-0 border-line bg-surface" />
        <div className="relative rounded-lg border border-line-2 bg-surface-2 p-3 transition group-hover:-translate-y-0.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-accent-dim">⊞</span>
            <h3 className="font-display text-lg font-bold tracking-tight text-ink">{card.title ?? "untitled board"}</h3>
          </div>
          {body && <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-faint">{body}</p>}
        </div>
      </div>
    );
  }

  switch (hero?.kind) {
    case "image":
    case "og":
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(hero.fileId, "thumb-400")}
            alt=""
            loading="lazy"
            className="w-full rounded-md object-cover transition duration-300 group-hover:brightness-110"
            style={hero.kind === "image" && hero.w && hero.h ? { aspectRatio: `${hero.w} / ${hero.h}` } : undefined}
          />
          {(card.title || body) && (
            <figcaption className="mt-2.5 line-clamp-3 text-[13px] leading-snug text-ink-dim">
              {card.title && <span className="text-ink">{card.title}</span>}
              {card.title && body && " — "}
              {body}
            </figcaption>
          )}
        </figure>
      );
    case "pdf":
      return (
        <div className="flex items-end gap-4">
          <PdfStack className="w-24 transition duration-300 group-hover:-rotate-2" />
          <div className="min-w-0 pb-1">
            <h3 className="font-display text-[17px] font-bold leading-snug tracking-tight text-ink">{headline(card)}</h3>
            {body && card.title && <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-ink-faint">{body}</p>}
          </div>
        </div>
      );
    case "audio":
      return (
        <div className="rounded-2xl bg-ember/[0.07] px-4 py-4 ring-1 ring-inset ring-ember/15">
          {card.title && <h3 className="mb-2 font-display text-[15px] font-bold tracking-tight text-ink">{card.title}</h3>}
          <div className="flex items-center gap-3">
            <span className="grid size-8 flex-none place-items-center rounded-full bg-ember text-[11px] text-inset">▶</span>
            <Waveform seed={hero.fileId} bars={40} className="h-8 flex-1" />
          </div>
          {body && <p className="mt-3 line-clamp-3 text-[13px] italic leading-relaxed text-ink-dim">{body}</p>}
        </div>
      );
    default:
      return (
        <div className="border-l border-line-2 pl-4 transition-colors group-hover:border-ink-faint">
          {card.title && (
            <h3 className="mb-1.5 font-display text-[19px] font-bold leading-snug tracking-tight text-ink">
              {card.type === "project" && <span className="mr-2 text-amber">◆</span>}
              {card.title}
            </h3>
          )}
          {body && (
            <p
              className={`line-clamp-[10] whitespace-pre-line leading-relaxed ${card.title ? "text-[14px] text-ink-dim" : "text-[16px] text-ink"}`}
            >
              {body}
            </p>
          )}
        </div>
      );
  }
}
