"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Composer } from "@/components/brain/Composer";
import { Kbd, useToast } from "@/components/brain/parts";
import { registerCaptureDialog, type CaptureOptions, type CreatedCard } from "@/lib/capture-bus";

/**
 * ⌘J (Ctrl+J elsewhere) opens the composer in the same overlay as search.
 * Mounted once in the app layout; the board canvas opens it through the
 * capture bus to place the new card itself.
 */
export function CaptureDialog() {
  const router = useRouter();
  const toast = useToast();
  const [opts, setOpts] = useState<CaptureOptions | null>(null);
  const open = opts !== null;

  const show = useCallback((options: CaptureOptions) => setOpts(options), []);
  useEffect(() => registerCaptureDialog(show), [show]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "j") return;
      e.preventDefault();
      setOpts((o) => (o === null ? {} : null));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function captured(card: CreatedCard) {
    const handled = opts?.onCreated?.(card) === true;
    setOpts(null);
    if (handled) return;
    if (card.type === "board") router.push(`/boards/${card.id}`);
    else toast.show(card.triagedAt ? "captured → library" : "captured → inbox");
  }

  return (
    <>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-inset/80 p-4 pt-[min(18vh,10rem)] backdrop-blur-sm transition-opacity duration-150 starting:opacity-0"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpts(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpts(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-label="Capture"
              className="w-full max-w-xl rounded-xl border border-line-2 bg-surface-2 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)]"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                <span>new item</span>
                <Kbd>esc</Kbd>
              </div>
              <Composer onToast={toast.show} onCaptured={captured} />
            </div>
          </div>,
          document.body,
        )}
      {toast.node}
    </>
  );
}
