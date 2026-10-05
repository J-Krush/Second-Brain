import type { ListCard } from "@/lib/cards";
import { styleFor } from "@/components/card-style";

/** `ListCard` as it arrives over JSON: dates are ISO strings. */
export type BrainCard = {
  [K in keyof ListCard]: ListCard[K] extends Date
    ? string
    : ListCard[K] extends Date | null
      ? string | null
      : ListCard[K];
};

export type Scope = "inbox" | "library";
export type View = "timeline" | "desk";

export const INLINE_FILE_RE = /!\[[^\]]*\]\(file:([0-9a-f-]+)\)/gi;

/** Body text with inline `![..](file:..)` embeds removed (they render as the hero). */
export function displayBody(card: { body: string | null }): string {
  if (!card.body) return "";
  return card.body.replace(INLINE_FILE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Quote-like kinds typeset as pull quotes. */
export function isQuote(type: string): boolean {
  return type === "quote" || type === "mantra";
}

/** Title, else first line of the body, else the kind label. */
export function headline(card: { type: string; title: string | null; body: string | null }): string {
  return card.title || displayBody(card).split("\n")[0]!.slice(0, 120) || styleFor(card.type).label;
}

/** Groups by local-time `YYYY-MM-DD`, so the daybook splits at the viewer's midnight. */
export function groupByDay<T extends { createdAt: string }>(items: T[]): Array<{ day: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const d = new Date(it.createdAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()].map(([day, items]) => ({ day, items }));
}

export function fmtDay(day: string): { dow: string; num: string; month: string; rel: string } {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  const rel = diff === 0 ? "Today" : diff === 1 ? "Yesterday" : `${diff} days ago`;
  return {
    dow: date.toLocaleDateString("en-US", { weekday: "short" }),
    num: day.slice(8, 10),
    month: date.toLocaleDateString("en-US", { month: "short" }),
    rel,
  };
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fmtBytes(b: number): string {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1000))} KB`;
}
