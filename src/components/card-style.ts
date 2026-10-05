/**
 * Per-type visual treatment. One signal hue per type over the ink-slate base;
 * chips are mono uppercase, matching the terminal-industrial system.
 */
export interface CardStyle {
  label: string;
  badge: string; // classes for the type chip
  accent: string; // left-border / accent color class
  glyph: string; // mono glyph for gutters; rows scan without a colored chip
  text: string; // text color class for the glyph / kind word
}

export const CARD_STYLE: Record<string, CardStyle> = {
  thought: { label: "Thought", badge: "bg-surface-2 text-ink-dim", accent: "border-line-2", glyph: "¶", text: "text-ink-dim" },
  quote: { label: "Quote", badge: "bg-accent/10 text-accent", accent: "border-accent", glyph: "“", text: "text-accent" },
  link: { label: "Link", badge: "bg-cyan/10 text-cyan", accent: "border-cyan", glyph: "↗", text: "text-cyan" },
  video: { label: "Video", badge: "bg-ember/10 text-ember", accent: "border-ember", glyph: "▶", text: "text-ember" },
  document: { label: "Doc", badge: "bg-surface-2 text-ink", accent: "border-ink-faint", glyph: "⎘", text: "text-ink" },
  project: { label: "Project", badge: "bg-amber/10 text-amber", accent: "border-amber", glyph: "◆", text: "text-amber" },
  board: { label: "Board", badge: "bg-accent/10 text-accent", accent: "border-accent-dim", glyph: "⊞", text: "text-accent-dim" },
  mantra: { label: "Mantra", badge: "bg-amber/10 text-amber", accent: "border-amber", glyph: "“", text: "text-amber" },
};

export function styleFor(type: string): CardStyle {
  return CARD_STYLE[type] ?? CARD_STYLE.thought!;
}
