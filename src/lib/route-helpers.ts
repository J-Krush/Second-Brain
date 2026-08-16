import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { bearerTokenValid } from "./auth";
import { SESSION_COOKIE, unsealSession } from "./session";

/**
 * Route-handler authorization. The proxy already redirects browsers without a
 * session and lets any `Bearer ...` request through unchecked, so handlers must
 * validate the token themselves here. Returns true when the caller is allowed.
 */
export async function authorize(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return bearerTokenValid(authHeader);
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
