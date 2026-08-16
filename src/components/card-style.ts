/**
 * Per-type visual treatment. One signal hue per type over the ink-slate base;
 * chips are mono uppercase, matching the terminal-industrial system.
 */
export interface CardStyle {
  label: string;
  badge: string; // classes for the type chip
  accent: string; // left-border / accent color class
}

export const CARD_STYLE: Record<string, CardStyle> = {
  thought: { label: "Thought", badge: "bg-surface-2 text-ink-dim", accent: "border-line-2" },
  quote: { label: "Quote", badge: "bg-accent/10 text-accent", accent: "border-accent" },
  link: { label: "Link", badge: "bg-cyan/10 text-cyan", accent: "border-cyan" },
  video: { label: "Video", badge: "bg-ember/10 text-ember", accent: "border-ember" },
  document: { label: "Doc", badge: "bg-surface-2 text-ink", accent: "border-ink-faint" },
  project: { label: "Project", badge: "bg-amber/10 text-amber", accent: "border-amber" },
  board: { label: "Board", badge: "bg-accent/10 text-accent", accent: "border-accent-dim" },
  mantra: { label: "Mantra", badge: "bg-amber/10 text-amber", accent: "border-amber" },
};

export function styleFor(type: string): CardStyle {
  return CARD_STYLE[type] ?? CARD_STYLE.thought!;
}
