import { sealData, unsealData } from "iron-session";
import { env } from "./env";

/**
 * Single-user session. The cookie payload only asserts "the password was
 * verified"; there is no user identity to carry.
 */
export interface SessionData {
  authenticated: true;
  createdAt: number;
}

export const SESSION_COOKIE = "sb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
// Reseal once the session is older than this, giving a rolling 30-day window
// without reissuing the cookie on every request.
const ROLL_THRESHOLD_SECONDS = 24 * 60 * 60;

export async function sealSession(data: SessionData): Promise<string> {
  return sealData(data, {
    password: env.SESSION_SECRET,
    ttl: SESSION_TTL_SECONDS,
  });
}

export async function unsealSession(
  cookieValue: string | undefined,
): Promise<SessionData | null> {
  if (!cookieValue) return null;
  const data = await unsealData<Partial<SessionData>>(cookieValue, {
    password: env.SESSION_SECRET,
    ttl: SESSION_TTL_SECONDS,
  });
  if (data?.authenticated === true && typeof data.createdAt === "number") {
    return { authenticated: true, createdAt: data.createdAt };
  }
  return null;
}

export function cookieOptions(maxAgeSeconds = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function shouldRoll(session: SessionData): boolean {
  return (Date.now() - session.createdAt) / 1000 > ROLL_THRESHOLD_SECONDS;
}
