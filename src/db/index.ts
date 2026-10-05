import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Workers forbid using a socket opened by one request from another request
 * ("Cannot perform I/O on behalf of a different request"), so a module-level
 * pool would crash on the second hit. Instead each request context gets its
 * own pool, keyed on the ExecutionContext OpenNext hands us. Hyperdrive keeps
 * the Neon side warm, so per-request connects are cheap.
 *
 * Under `next dev` and in tests the context object is a single long-lived
 * stand-in, which degrades to one shared pool, exactly the old behaviour.
 * `DATABASE_URL` is the fallback for scripts and tests that run outside the
 * Cloudflare context.
 */
const pools = new WeakMap<object, Db>();

// Boundary type for the fields of CloudflareEnv this module reads.
interface DbEnv {
  HYPERDRIVE?: { connectionString: string };
}

function connectionString(): string {
  const { env } = getCloudflareContext() as { env: DbEnv };
  const url = env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("No HYPERDRIVE binding and DATABASE_URL is unset");
  return url;
}

function currentDb(): Db {
  const { ctx } = getCloudflareContext();
  const existing = pools.get(ctx);
  if (existing) return existing;

  const pool = new Pool({ connectionString: connectionString(), max: 3 });
  // The runtime tears sockets down when the request context ends; pg surfaces
  // that as an idle-client error which must not become an unhandled event.
  pool.on("error", () => {});
  const instance = drizzle(pool, { schema });
  pools.set(ctx, instance);
  return instance;
}

/**
 * Drop-in for a module-level drizzle instance: every property access resolves
 * against the current request's database, so callers keep `import { db }`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = currentDb();
    const value = Reflect.get(instance, prop) as unknown;
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
