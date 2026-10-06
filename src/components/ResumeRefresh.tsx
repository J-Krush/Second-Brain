"use client";

import { useEffect } from "react";
import { emitCardChanged } from "@/lib/card-events";

// Longer than a quick app switch; shorter than "I captured something from the
// share sheet and came back to look at it".
const STALE_AFTER_MS = 30_000;

/**
 * An installed (home-screen) app is resumed, not reloaded, so the inbox it
 * shows is whatever it fetched last time. When the page becomes visible after
 * being hidden for a while, fire the same signal a mutation would so every
 * list, count, and facet refetches.
 */
export function ResumeRefresh() {
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS) {
        emitCardChanged();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return null;
}
