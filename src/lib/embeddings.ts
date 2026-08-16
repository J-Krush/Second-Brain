import { createHash } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "@/db";
import { cards } from "@/db/schema";
import { env } from "./env";

/**
 * Single module wrapping the embedding provider so it stays swappable. The
 * column dimension is fixed at 1536 (OpenAI text-embedding-3-small); a provider
 * change that alters dimensions requires a migration + re-embed.
 */
export const EMBEDDING_DIMS = 1536;
const MODEL = "text-embedding-3-small";
// text-embedding-3-small handles 8191 tokens; ~4 chars/token, cap generously.
const MAX_CHARS = 24000;

let openai: OpenAI | undefined;

export function embeddingsConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

export function contentHash(title: string | null, body: string | null): string {
  return createHash("sha256")
    .update(`${title ?? ""}\n\n${body ?? ""}`)
    .digest("hex");
}

function embedInput(title: string | null, body: string | null): string {
  return `${title ?? ""}\n\n${body ?? ""}`.trim().slice(0, MAX_CHARS);
}

export async function embedText(text: string): Promise<number[]> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  openai ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const res = await openai.embeddings.create({ model: MODEL, input: text });
  return res.data[0]!.embedding;
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
