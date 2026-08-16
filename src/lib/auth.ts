import { verify } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "./env";

export async function verifyPassword(password: string): Promise<boolean> {
  try {
    return await verify(env.APP_PASSWORD_HASH, password);
  } catch {
    // Malformed hash env var, etc. Fail closed.
    return false;
  }
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 5;

/**
 * Fixed-window login rate limit backed by Postgres so it holds across
 * serverless instances. Returns true when the attempt is allowed.
 */
export async function checkLoginRate(ip: string): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS,
  );
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO login_attempts (ip, window_start, count)
    VALUES (${ip}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (ip, window_start)
    DO UPDATE SET count = login_attempts.count + 1
    RETURNING count
  `);
  const count = rows.rows[0]?.count ?? 1;
  return count <= RATE_MAX_ATTEMPTS;
}

export function bearerTokenValid(header: string | null): boolean {
  if (!header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const presented = header.slice(prefix.length);
  // Accept the capture-client token or the Vercel cron secret.
  const accepted = [env.API_TOKEN, env.CRON_SECRET].filter(Boolean);
  return accepted.includes(presented);
}
