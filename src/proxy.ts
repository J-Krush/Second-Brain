import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  cookieOptions,
  sealSession,
  shouldRoll,
  unsealSession,
} from "@/lib/session";

/**
 * Guards every page and API route except /login and the login endpoint.
 * Browser requests without a valid session are redirected to /login; API
 * requests get a 401. Bearer-token auth for non-browser capture clients is
 * checked inside the route handlers (proxy runs on the edge and cannot read
 * env-based secrets comparison timing-safely as reliably as Node routes).
 */
const PUBLIC_PATHS: Record<string, true> = {
  "/login": true,
  "/api/auth/login": true,
  "/manifest.webmanifest": true,
};

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS[pathname]) return NextResponse.next();

  // Bearer-token capture clients bypass the session redirect; the route
  // handler validates the token itself.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await unsealSession(cookie);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (shouldRoll(session)) {
    const resealed = await sealSession({
      authenticated: true,
      createdAt: Date.now(),
    });
    response.cookies.set(SESSION_COOKIE, resealed, cookieOptions());
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
