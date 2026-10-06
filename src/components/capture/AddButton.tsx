"use client";

import { openCapture } from "@/lib/capture-bus";

/** Header entry point for the capture dialog; ⌘J does the same thing. */
export function AddButton() {
  return (
    <button
      type="button"
      onClick={() => openCapture()}
      aria-keyshortcuts="Meta+J"
      className="flex h-8 flex-none items-center gap-2 rounded-md bg-accent px-3 font-mono text-xs font-bold uppercase tracking-wider text-inset transition-opacity hover:opacity-90 sm:pr-1.5"
    >
      <span>+ add</span>
      <span className="hidden items-center gap-0.5 rounded bg-inset/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal sm:flex">
        <span>⌘</span>
        <span>J</span>
      </span>
    </button>
  );
}
