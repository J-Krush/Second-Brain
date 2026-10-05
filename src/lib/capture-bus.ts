/**
 * Tiny client-side bus so any surface (hotkey, inbox button, board canvas)
 * can open the global capture modal. The board canvas passes onCreated to
 * intercept the new card and place it; returning true suppresses the modal's
 * default navigation/refresh.
 */
export interface CreatedCard {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  props: unknown;
}

export interface CaptureOptions {
  defaultType?: string;
  onCreated?: (card: CreatedCard) => boolean | void;
}

type Listener = (opts: CaptureOptions) => void;

let listener: Listener | null = null;

export function registerCaptureModal(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function openCapture(opts: CaptureOptions = {}): void {
  listener?.(opts);
}
