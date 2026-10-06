"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { styleFor } from "@/components/card-style";
import { emitCardChanged } from "@/lib/card-events";
import { openCard } from "@/lib/card-url";
import { sourceOf } from "@/lib/source";
import { displayBody, fmtBytes, fmtDay, fmtTime, groupByDay, headline, isQuote, type BrainCard, type Scope } from "./item";
import { PdfStack, SiteMark, Waveform, fileUrl, heroOf, stagger } from "./parts";

/**
 * A daybook: one column, days as a sticky margin, every kind typeset as
 * itself (a quote looks like a quote, a PDF looks like paper).
 */
export function Timeline({ items, scope, onToast }: { items: BrainCard[]; scope: Scope; onToast: (msg: string) => void }) {
  let index = 0;
  return (
    <div className="mx-auto max-w-[46rem]">
      {groupByDay(items).map(({ day, items: dayItems }) => {
        const d = fmtDay(day);
        return (
          <section
            key={day}
            className="relative mt-12 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-6 border-t border-line pt-6 sm:grid-cols-[5.5rem_minmax(0,1fr)]"
          >
            <header className="sticky top-[calc(var(--sb-bar,8rem)+4.5rem)] self-start">
              <div className="font-display text-5xl font-extrabold leading-none tracking-tighter text-ink">{d.num}</div>
              <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                {d.dow} · {d.month}
              </div>
              <div className={`mt-0.5 font-mono text-[10px] ${d.rel === "Today" ? "text-accent" : "text-ink-faint"}`}>
                {d.rel.toLowerCase()}
              </div>
            </header>
            {/* Hairlines, not frames: entries read as separate without turning into Desk tiles. */}
            <div className="divide-y divide-line/70">
              {dayItems.map((card) => (
                <Entry key={card.id} card={card} index={index++} scope={scope} onToast={onToast} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

async function archive(card: BrainCard, onToast: (msg: string) => void) {
  const res = await fetch(`/api/cards/${card.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ triaged: true }),
  });
  if (!res.ok) {
    onToast("archive failed");
    return;
  }
  onToast(`archived · ${headline(card)}`);
  emitCardChanged(card.id);
}

function Entry({
  card,
  index,
  scope,
  onToast,
}: {
  card: BrainCard;
  index: number;
  scope: Scope;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const style = styleFor(card.type);
  const isBoard = card.type === "board";
  const open = () => (isBoard ? router.push(`/boards/${card.id}`) : openCard(card.id));

  return (
    <article style={stagger(index)} className="sb-rise group py-9 first:pt-0">
      <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[11px] text-ink-faint">
        <span className="tabular-nums">{fmtTime(card.createdAt)}</span>
        {card.triagedAt === null && <span className="size-1.5 rounded-full bg-accent" aria-label="untriaged" />}
        <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {scope === "inbox" && card.triagedAt === null && (
            <button
              type="button"
              onClick={() => void archive(card, onToast)}
              className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink"
            >
              archive
            </button>
          )}
          <button type="button" onClick={open} className="rounded px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink">
            open
          </button>
        </span>
      </div>

      <div
        className="cursor-pointer"
        onClick={(e) => {
          if ((e.target as Element).closest("a,button,audio,video,input,select,textarea")) return;
          open();
        }}
      >
        <EntryBody card={card} />
      </div>

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
        <span className={style.text}>
          {style.glyph} {style.label.toLowerCase()}
        </span>
        {card.tags.map((t) => (
          <span key={t.id}>#{t.name}</span>
        ))}
      </footer>
    </article>
  );
}

function EntryBody({ card }: { card: BrainCard }) {
  const hero = heroOf(card);
  const body = displayBody(card);
  const source = sourceOf(card);

  if (isQuote(card.type)) {
    return (
      <figure className="relative">
        <span
          className={`absolute -left-7 -top-2 font-display text-5xl leading-none ${card.type === "mantra" ? "text-amber" : "text-accent"}`}
        >
          “
        </span>
        <blockquote className="whitespace-pre-line font-display text-[26px] font-semibold leading-[1.25] tracking-tight text-ink">
          {body || card.title}
        </blockquote>
        {source.via === "book" && (source.author || source.work) && (
          <figcaption className="mt-3 text-[13px] text-ink-dim">
            — {source.author}
            {source.author && source.work && ", "}
            {source.work && <span className="italic">{source.work}</span>}
            {source.page && <span className="font-mono text-[11px] text-ink-faint"> · p.{source.page}</span>}
          </figcaption>
        )}
      </figure>
    );
  }

  if (card.type === "link" || card.type === "video") {
    const domain = source.via === "web" ? source.domain : card.url ? new URL(card.url).hostname : "";
    const image = hero?.kind === "og" || hero?.kind === "image" ? hero.fileId : null;
    return (
      <div className="group/link block">
        {image && (
          <span className="relative mb-4 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fileUrl(image, "thumb-1200")}
              alt=""
              loading="lazy"
              className="aspect-[12/5] w-full rounded-lg object-cover opacity-90 ring-1 ring-line transition group-hover/link:opacity-100"
            />
            {card.type === "video" && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-12 place-items-center rounded-full bg-base/70 text-ink ring-1 ring-ink/20 backdrop-blur">
                  ▶
                </span>
              </span>
            )}
          </span>
        )}
        <a
          href={card.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-faint hover:text-cyan"
        >
          <SiteMark label={domain} className="size-4 text-[9px]" />
          {domain} <span className="text-cyan">↗</span>
        </a>
        <h3 className="mt-1.5 font-display text-xl font-bold leading-snug tracking-tight text-ink transition-colors group-hover/link:text-accent">
          {card.title ?? card.url}
        </h3>
        {body && (
          <p className="mt-2 whitespace-pre-line border-l-2 border-line-2 pl-3 text-[14px] leading-relaxed text-ink-dim">
            {body}
          </p>
        )}
      </div>
    );
  }

  if (card.type === "board") {
    return (
      <p className="text-[14px] text-ink-dim">
        New board{" "}
        <Link href={`/boards/${card.id}`} className="font-display text-base font-bold text-ink hover:text-accent">
          {card.title ?? "untitled"}
        </Link>
        {body && <span className="text-ink-faint"> — {body}</span>}
      </p>
    );
  }

  const title = card.title && (
    <h3 className="font-display text-xl font-bold tracking-tight text-ink">
      {card.type === "project" && <span className="mr-2 text-amber">◆</span>}
      {card.title}
    </h3>
  );

  switch (hero?.kind) {
    case "image":
    case "og":
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(hero.fileId, "thumb-1200")}
            alt=""
            loading="lazy"
            className="max-h-[32rem] w-full rounded-lg object-cover ring-1 ring-line"
            style={hero.kind === "image" && hero.w && hero.h ? { aspectRatio: `${hero.w} / ${hero.h}` } : undefined}
          />
          {(card.title || body) && (
            <figcaption className="mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ink-dim">
              {card.title && <span className="font-medium text-ink">{card.title}. </span>}
              {body}
            </figcaption>
          )}
        </figure>
      );
    case "pdf":
      return (
        <div className="flex gap-5">
          <PdfStack className="w-[4.5rem]" />
          <div className="min-w-0 pt-1">
            <h3 className="font-display text-lg font-bold leading-snug tracking-tight text-ink">{headline(card)}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">pdf · {fmtBytes(hero.bytes)}</p>
            {body && card.title && <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink-dim">{body}</p>}
          </div>
        </div>
      );
    case "audio":
      return (
        <div>
          {title && <div className="mb-2">{title}</div>}
          <div className="flex items-center gap-3">
            <Waveform seed={hero.fileId} bars={56} className="h-10 w-40 flex-none" />
            {/* Native controls: the waveform is decoration, this is the player. */}
            <audio controls preload="none" src={fileUrl(hero.fileId, "original")} className="h-9 min-w-0 flex-1" />
          </div>
          {body && <p className="mt-3 whitespace-pre-line text-[14px] italic leading-relaxed text-ink-dim">{body}</p>}
        </div>
      );
    default:
      return (
        <div>
          {title && <div className="mb-1.5">{title}</div>}
          {body && <p className="whitespace-pre-line text-[16px] leading-[1.7] text-ink-dim">{body}</p>}
        </div>
      );
  }
}
