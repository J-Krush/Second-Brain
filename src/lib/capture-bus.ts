/**
 * Tiny client-side bus so any surface (hotkey, board canvas) can open the
 * global capture dialog. The board canvas passes onCreated to intercept the
 * new card and place it; returning true suppresses the dialog's default
 * follow-up (toast, or navigating into a new board).
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
  onCreated?: (card: CreatedCard) => boolean | void;
}

type Listener = (opts: CaptureOptions) => void;

let listener: Listener | null = null;

export function registerCaptureDialog(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function openCapture(opts: CaptureOptions = {}): void {
  listener?.(opts);
}
