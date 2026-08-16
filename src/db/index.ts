import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * One pooled client for the whole app. node-postgres works identically
 * against local Postgres and Neon's pooled endpoint, keeping a single code
 * path. The Neon serverless HTTP driver is only worth it if cold-start
 * connection latency becomes a problem; swapping is local to this file.
 */
declare global {
  // eslint-disable-next-line no-var
  var __sbPool: Pool | undefined;
}

const pool =
  globalThis.__sbPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalThis.__sbPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
