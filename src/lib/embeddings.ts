import { createHash } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { env } from "./env";

/**
 * Single module wrapping the embedding provider so it stays swappable. The
 * column dimension is fixed at 1024 (Workers AI @cf/baai/bge-m3); a provider
 * change that alters dimensions requires a migration + re-embed.
 */
export const EMBEDDING_DIMS = 1024;
const MODEL = "@cf/baai/bge-m3";
// bge-m3 accepts 8192 tokens; ~4 chars/token, cap generously.
const MAX_CHARS = 24000;

// Boundary type for the Workers AI binding (wrangler.jsonc `ai`).
interface AiEnv {
  AI?: { run(model: string, input: { text: string[] }): Promise<{ data: number[][] }> };
}

/**
 * The binding in the deployed Worker. Under `next dev` remote bindings are off
 * and wrangler hands back a stub that throws, so dev skips it and falls back
 * to REST (CF_* vars) or, with neither, to FTS-only search.
 */
function aiBinding(): AiEnv["AI"] {
  if (process.env.NODE_ENV === "development") return undefined;
  const { env: cfEnv } = getCloudflareContext() as { env: AiEnv };
  return cfEnv.AI;
}

export function embeddingsConfigured(): boolean {
  return Boolean(aiBinding() || (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN));
}

export function contentHash(title: string | null, body: string | null): string {
  return createHash("sha256")
    .update(`${title ?? ""}\n\n${body ?? ""}`)
    .digest("hex");
}

function embedInput(title: string | null, body: string | null): string {
  return `${title ?? ""}\n\n${body ?? ""}`.trim().slice(0, MAX_CHARS);
}

// Response boundary for POST /accounts/{id}/ai/run/@cf/baai/bge-m3.
interface WorkersAiEmbeddingResponse {
  success: boolean;
  errors?: { message: string }[];
  result?: { data: number[][] };
}

export async function embedText(text: string): Promise<number[]> {
  const binding = aiBinding();
  if (binding) {
    const vector = (await binding.run(MODEL, { text: [text] })).data[0];
    if (!vector) throw new Error("Workers AI embedding returned no vector");
    return vector;
  }
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) {
    throw new Error("CF_ACCOUNT_ID / CF_AI_TOKEN not set");
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${MODEL}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CF_AI_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: [text] }),
    },
  );
  const data = (await res.json()) as WorkersAiEmbeddingResponse;
  const vector = data.result?.data[0];
  if (!res.ok || !data.success || !vector) {
    throw new Error(
      `Workers AI embedding failed: ${data.errors?.[0]?.message ?? res.status}`,
    );
  }
  return vector;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Embed one card if its content hash changed. Empty-text cards get a null
 * embedding and are excluded from vector search. Safe to call redundantly
 * (via after() on every save): unchanged content is a no-op.
 */
export async function embedCard(cardId: string): Promise<void> {
  const [card] = await db
    .select({
      title: cards.title,
      body: cards.body,
      embeddingHash: cards.embeddingHash,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return;

  const input = embedInput(card.title, card.body);
  const hash = contentHash(card.title, card.body);
  if (hash === card.embeddingHash) return; // already current

  if (!input) {
    // No text: clear any stale vector, record the hash so we stop retrying.
    await db
      .update(cards)
      .set({ embedding: null, embeddingHash: hash, embeddedAt: new Date() })
      .where(eq(cards.id, cardId));
    return;
  }

  if (!embeddingsConfigured()) return; // will be picked up by the sweep later

  const vec = await embedText(input);
  await db
    .update(cards)
    .set({
      embedding: sql`${toVectorLiteral(vec)}::vector`,
      embeddingHash: hash,
      embeddedAt: new Date(),
    })
    .where(eq(cards.id, cardId));
}

/**
 * Batch-embed cards whose stored hash is missing or stale. Backs the cron
 * sweep and the manual admin action; also catches cards saved while the API
 * key was absent.
 */
export async function sweepStaleEmbeddings(limit = 100): Promise<number> {
  if (!embeddingsConfigured()) return 0;
  const stale = await db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        isNull(cards.deletedAt),
        sql`length(trim(coalesce(${cards.title},'') || ' ' || coalesce(${cards.body},''))) > 0`,
        or(
          isNull(cards.embeddingHash),
          isNull(cards.embeddedAt),
          sql`${cards.updatedAt} > ${cards.embeddedAt}`,
        ),
      ),
    )
    .orderBy(cards.updatedAt)
    .limit(limit);

  let embedded = 0;
  for (const card of stale) {
    await embedCard(card.id);
    embedded += 1;
  }
  return embedded;
}
