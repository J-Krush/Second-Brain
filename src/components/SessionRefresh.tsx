"use client";

import { useEffect } from "react";

/**
 * Rendered by the (app) layout only when the session is due for a reseal;
 * layouts cannot set cookies, so the roll happens via a one-off POST.
 */
export function SessionRefresh() {
  useEffect(() => {
    void fetch("/api/auth/refresh", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
