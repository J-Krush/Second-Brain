import { createHash } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { aiBinding, aiRest, workersAiConfigured } from "./workers-ai";

/**
 * Single module wrapping the embedding provider so it stays swappable. The
 * column dimension is fixed at 1024 (Workers AI @cf/baai/bge-m3); a provider
 * change that alters dimensions requires a migration + re-embed.
 */
export const EMBEDDING_DIMS = 1024;
const MODEL = "@cf/baai/bge-m3";
// bge-m3 accepts 8192 tokens; ~4 chars/token, cap generously.
const MAX_CHARS = 24000;

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

/**
 * Embed several texts in one model call, in input order. Batching is how the
 * transcript chunk sweep keeps per-passage embeddings cheap.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const input = { text: texts.map((t) => t.slice(0, MAX_CHARS)) };
  const binding = aiBinding();
  let vectors: number[][] | undefined;
  if (binding) {
    vectors = (await binding.run(MODEL, input)).data;
  } else {
    const res = await aiRest(MODEL, input);
    const data = (await res.json()) as WorkersAiEmbeddingResponse;
    if (!res.ok || !data.success) {
      throw new Error(`Workers AI embedding failed: ${data.errors?.[0]?.message ?? res.status}`);
    }
    vectors = data.result?.data;
  }
  if (vectors?.length !== texts.length) {
    throw new Error(`Workers AI embedding returned ${vectors?.length ?? 0} vectors for ${texts.length} texts`);
  }
  return vectors;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error("Workers AI embedding returned no vector");
  return vector;
}

/** pgvector text literal; bound as a parameter and cast with `::vector` in SQL. */
export function toVectorLiteral(vec: number[]): string {
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

  if (!workersAiConfigured()) return; // will be picked up by the sweep later

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
  if (!workersAiConfigured()) return 0;
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
