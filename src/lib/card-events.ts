/**
 * Window-level "a card changed" signal. The composer and detail modal emit
 * after any mutation; list views listen and refetch. Kept off React context so
 * the modal (mounted anywhere) and the page never need a shared provider.
 */
const EVENT = "sb:card-changed";

export function emitCardChanged(id?: string): void {
  window.dispatchEvent(new CustomEvent<string | undefined>(EVENT, { detail: id }));
}

export function onCardChanged(fn: (id?: string) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<string | undefined>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

const PREVIEW_POLL_MS = 1000;
const PREVIEW_POLL_LIMIT = 20;

/**
 * The server fills a link card's OpenGraph preview (and untitled title) in
 * `after()`, once the save response is already back, so the emit that follows
 * the save refetches too early. Poll the card until its props differ from the
 * saved ones, then emit again. Bounded: `captureLink` writes nothing on failure.
 */
export function emitWhenLinkPreviewed(card: { id: string; props: unknown }): void {
  const saved = JSON.stringify(card.props);
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    const res = await fetch(`/api/cards/${card.id}`).catch(() => null);
    if (res?.ok) {
      const { card: latest } = (await res.json()) as { card: { props: unknown } };
      if (JSON.stringify(latest.props) !== saved) return emitCardChanged(card.id);
    }
    if (attempts < PREVIEW_POLL_LIMIT) window.setTimeout(poll, PREVIEW_POLL_MS);
  };
  window.setTimeout(poll, PREVIEW_POLL_MS);
}
