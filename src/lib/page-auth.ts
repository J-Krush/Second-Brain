import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, type SessionData, unsealSession } from "./session";

/**
 * Page-side session gate (replaces the Next proxy, which OpenNext Cloudflare
 * does not run). Called from the (app) layout AND every page: layouts are
 * skipped on client-side navigation and do not stop sibling segments from
 * rendering into the RSC payload, so a layout-only check would leak page data.
 * `cache` dedupes the unseal within one render.
 */
export const requireSession = cache(async (): Promise<SessionData> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await unsealSession(cookie);
  if (!session) redirect("/login");
  return session;
});
