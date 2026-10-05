import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/route-helpers";
import {
  SESSION_COOKIE,
  cookieOptions,
  sealSession,
  unsealSession,
} from "@/lib/session";

export const runtime = "nodejs";

/**
 * Rolls the session cookie forward. Layouts cannot set cookies, so the (app)
 * layout renders <SessionRefresh /> when the session is due for a reseal and
 * that client component calls this once.
 */
export async function POST() {
  const jar = await cookies();
  const session = await unsealSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return unauthorized();
  const sealed = await sealSession({ authenticated: true, createdAt: Date.now() });
  jar.set(SESSION_COOKIE, sealed, cookieOptions());
  return NextResponse.json({ ok: true });
}
