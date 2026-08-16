import Link from "next/link";
import { relativeTime } from "@/lib/format";
import { styleFor } from "./card-style";

export interface CardLike {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: Date | string;
}

function snippet(text: string | null, max = 240): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "\u2026" : clean;
}

export function CardRow({ card }: { card: CardLike }) {
  const style = styleFor(card.type);
  const isQuote = card.type === "quote" || card.type === "mantra";
  const body = snippet(card.body);
  const href = card.type === "board" ? `/boards/${card.id}` : `/cards/${card.id}`;

  return (
    <Link
      href={href}
      className={`block border-l-2 ${style.accent} rounded-r-lg bg-surface px-4 py-3 transition-colors hover:bg-surface-2`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-xs text-ink-faint">{relativeTime(card.createdAt)}</span>
      </div>
      {card.title && (
        <h3 className="font-medium text-ink">{card.title}</h3>
      )}
      {body && (
        <p
          className={
            isQuote
              ? "mt-0.5 font-serif text-lg italic text-ink-dim"
              : "mt-0.5 text-sm text-ink-dim"
          }
        >
          {body}
        </p>
      )}
      {card.url && (
        <p className="mt-1 truncate text-xs text-sky-400/70">{card.url}</p>
      )}
    </Link>
  );
}
