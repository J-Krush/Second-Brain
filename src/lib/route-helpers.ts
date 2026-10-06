import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenValid } from "./auth";
import { SESSION_COOKIE, unsealSession } from "./session";

/**
 * Route-handler authorization. There is no proxy/middleware in front of API
 * routes (OpenNext Cloudflare does not run Next's proxy), so every handler
 * must call this: it accepts a valid Bearer token or a session cookie.
 * Capture-only routes pass `"capture"` to also accept `CAPTURE_TOKEN`.
 * Returns true when the caller is allowed.
 */
export async function authorize(request: NextRequest, scope: "full" | "capture" = "full"): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return bearerTokenValid(authHeader, scope === "capture");
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await unsealSession(cookie)) !== null;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
