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
