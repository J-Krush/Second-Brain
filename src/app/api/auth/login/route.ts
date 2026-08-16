import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { checkLoginRate, verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, cookieOptions, sealSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (!(await checkLoginRate(ip))) {
    return NextResponse.json(
      { error: "too many attempts, try again shortly" },
      { status: 429 },
    );
  }

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    password = undefined;
  }

  if (typeof password !== "string" || !(await verifyPassword(password))) {
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const sealed = await sealSession({ authenticated: true, createdAt: Date.now() });
  (await cookies()).set(SESSION_COOKIE, sealed, cookieOptions());
  return NextResponse.json({ ok: true });
}
