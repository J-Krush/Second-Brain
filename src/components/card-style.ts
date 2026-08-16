/**
 * Per-type visual treatment. Each card type gets a distinct feel so the inbox
 * and library read as a crafted space, not a uniform table.
 */
export interface CardStyle {
  label: string;
  badge: string; // tailwind classes for the type chip
  accent: string; // left-border / accent color class
}

export const CARD_STYLE: Record<string, CardStyle> = {
  thought: { label: "Thought", badge: "bg-surface-2 text-ink-dim", accent: "border-l-line" },
  quote: { label: "Quote", badge: "bg-accent-dim/20 text-accent", accent: "border-l-accent" },
  link: { label: "Link", badge: "bg-sky-500/15 text-sky-300", accent: "border-l-sky-500/50" },
  video: { label: "Video", badge: "bg-rose-500/15 text-rose-300", accent: "border-l-rose-500/50" },
  document: { label: "Document", badge: "bg-emerald-500/15 text-emerald-300", accent: "border-l-emerald-500/50" },
  project: { label: "Project", badge: "bg-violet-500/15 text-violet-300", accent: "border-l-violet-500/50" },
  board: { label: "Board", badge: "bg-amber-500/15 text-amber-300", accent: "border-l-amber-500/50" },
  mantra: { label: "Mantra", badge: "bg-accent-dim/20 text-accent", accent: "border-l-accent" },
};

export function styleFor(type: string): CardStyle {
  return CARD_STYLE[type] ?? CARD_STYLE.thought!;
}
