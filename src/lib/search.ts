import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedText, embeddingsConfigured } from "./embeddings";
import { reciprocalRankFusion } from "./rrf";

export type SearchMode = "quick" | "fts" | "semantic" | "hybrid";

export interface SearchHit {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  score: number;
}

export interface SearchFilters {
  type?: string;
  tagId?: number;
  limit?: number;
  /**
   * `all` (default) is websearch semantics: every term must match, which is
   * what a search box wants. `any` ORs the question's lexemes and lets
   * ts_rank order by how many hit, which is what retrieval for /ask wants:
   * "what do I know about X" must not require a card to contain "know".
   */
  match?: "all" | "any";
}

// Shared filter fragments so every mode applies type/tag consistently.
function typeFragment(type: string | undefined) {
  return type ? sql`AND c.type = ${type}` : sql``;
}

function tagFragment(tagId: number | undefined) {
  return tagId
    ? sql`AND EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id = c.id AND ct.tag_id = ${tagId})`
    : sql``;
}

/**
 * Quick switcher: word_similarity for typo-tolerant, as-you-type matches on
 * the title, falling back to the body's first line for untitled cards
 * (thoughts/quotes usually have no title).
 */
export async function searchQuick(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 20;
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           greatest(
             word_similarity(${q}, coalesce(c.title,'')),
             word_similarity(${q}, left(coalesce(c.body,''), 200))
           ) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND greatest(
            word_similarity(${q}, coalesce(c.title,'')),
            word_similarity(${q}, left(coalesce(c.body,''), 200))
          ) > 0.2
      ${typeFragment(filters.type)}
      ${tagFragment(filters.tagId)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as SearchHit[];
}

/**
 * The tsquery for a user string. `any` extracts lexemes with the same
 * normalisation as the indexed column (stopwords gone, stems applied) and
 * ORs them; each is quoted so URLs and apostrophes survive the re-parse.
 */
function tsquery(q: string, match: SearchFilters["match"]) {
  if (match === "any") {
    return sql`(SELECT to_tsquery('english', coalesce(string_agg(quote_literal(lexeme), ' | '), ''))
                FROM unnest(to_tsvector('english', ${q})))`;
  }
  return sql`websearch_to_tsquery('english', ${q})`;
}

/**
 * Full-text against the generated `search` column, ranked with ts_rank
 * (title weight A already outranks body weight B).
 */
export async function searchFts(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 50;
  const query = tsquery(q, filters.match);
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           ts_rank(c.search, ${query}) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND c.search @@ ${query}
      ${typeFragment(filters.type)}
      ${tagFragment(filters.tagId)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as SearchHit[];
}

/**
 * Semantic: cosine distance over the pgvector embedding, using the HNSW index
 * (`<=>` operator). Score is similarity (1 - distance). Cards without an
 * embedding are excluded by the NOT NULL guard.
 */
export async function semanticByVector(
  vec: number[],
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 50;
  const literal = `[${vec.join(",")}]`;
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           1 - (c.embedding <=> ${literal}::vector) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND c.embedding IS NOT NULL
      ${typeFragment(filters.type)}
      ${tagFragment(filters.tagId)}
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return rows.rows as unknown as SearchHit[];
}

export async function searchSemantic(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const vec = await embedText(q);
  return semanticByVector(vec, filters);
}

export interface HybridResult {
  hits: SearchHit[];
  degraded: boolean; // true when embeddings are unavailable (fts only)
}

/**
 * Hybrid: run FTS and semantic in parallel, fuse with RRF. When embeddings
 * are not configured it degrades to FTS alone and flags `degraded`.
 */
export async function searchHybrid(
  q: string,
  filters: SearchFilters = {},
): Promise<HybridResult> {
  if (!embeddingsConfigured()) {
    return { hits: await searchFts(q, filters), degraded: true };
  }
  const [fts, semantic] = await Promise.all([
    searchFts(q, filters),
    searchSemantic(q, filters),
  ]);
  const fused = reciprocalRankFusion([fts, semantic]);
  const limit = filters.limit ?? 50;
  return { hits: fused.slice(0, limit), degraded: false };
}
