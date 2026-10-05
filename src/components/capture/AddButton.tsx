"use client";

import { openCapture } from "@/lib/capture-bus";

/** Header entry point for the capture dialog; ⌘J does the same thing. */
export function AddButton() {
  return (
    <button
      type="button"
      onClick={() => openCapture()}
      aria-keyshortcuts="Meta+J"
      className="flex h-8 flex-none items-center gap-2 rounded-md bg-accent pl-3 pr-1.5 font-mono text-xs font-bold uppercase tracking-wider text-inset transition-opacity hover:opacity-90"
    >
      <span>+ add</span>
      <span className="flex items-center gap-0.5 rounded bg-inset/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal">
        <span>⌘</span>
        <span>J</span>
      </span>
    </button>
  );
}
