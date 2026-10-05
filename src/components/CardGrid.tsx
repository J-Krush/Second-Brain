import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { styleFor } from "./card-style";

export interface GridCard {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: Date | string;
  props?: unknown;
}

function snippet(text: string | null, max = 180): string {
  if (!text) return "";
  const clean = text.replace(/!\[[^\]]*\]\(file:[0-9a-f-]+\)/gi, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "\u2026" : clean;
}

function ogImage(card: GridCard): string | null {
  const og = (card.props as Record<string, unknown> | undefined)?.og as
    | { image?: string }
    | undefined;
  return og?.image ? `/api/files/${og.image}/thumb-400` : null;
}

export function CardGridItem({ card }: { card: GridCard }) {
  const style = styleFor(card.type);
  const isQuote = card.type === "quote" || card.type === "mantra";
  const href = card.type === "board" ? `/boards/${card.id}` : `/cards/${card.id}`;
  const body = snippet(card.body);
  const img = ogImage(card);

  return (
    <Link
      href={href}
      className={`group flex flex-col overflow-hidden rounded-xl border-t-2 ${style.accent} border border-line bg-surface transition-all hover:-translate-y-0.5 hover:border-line-2 hover:bg-surface-2`}
    >
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="h-28 w-full object-cover" loading="lazy" />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest ${style.badge}`}
          >
            {style.label}
          </span>
          <span className="ml-auto font-mono text-[10px] text-ink-faint">
            {relativeTime(card.createdAt)}
          </span>
        </div>
        {card.title && (
          <h3 className="font-display text-lg font-bold leading-snug tracking-tight text-ink">
            {card.title}
          </h3>
        )}
        {body && (
          <p
            className={`text-sm leading-relaxed text-ink-dim ${
              isQuote ? "text-[15px] italic" : ""
            } line-clamp-4`}
          >
            {isQuote ? `\u201C${body}\u201D` : body}
          </p>
        )}
        {card.url && (
          <p className="mt-auto truncate font-mono text-[11px] text-cyan/80">
            {card.url.replace(/^https?:\/\//, "")}
          </p>
        )}
      </div>
    </Link>
  );
}

export function CardGrid({ cards }: { cards: GridCard[] }) {
  if (cards.length === 0) {
    return (
      <p className="py-16 text-center font-mono text-sm text-ink-faint">
        nothing here. press <kbd className="rounded bg-surface-2 px-1.5 py-0.5">c</kbd> to capture.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <CardGridItem key={card.id} card={card} />
      ))}
    </div>
  );
}
