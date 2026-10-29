import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedText } from "./embeddings";
import { workersAiConfigured } from "./workers-ai";
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

// A trailing word still being typed: preceded by the start, whitespace, or a separator the
// parser splits on (an apostrophe). `.@/-_:+` join tokens (`node.js`, `a@b.io`, `/usr/bin`,
// `state-of-the-art`), and a leading `-` is negation, so those stay whole terms.
const TRAILING_WORD = /^(|.*[^.@/\-_:+\p{L}\p{N}])([\p{L}\p{N}]+)$/u;

/**
 * The full-text condition and rank query for a user string. `any` extracts
 * lexemes with the same normalisation as the indexed column (stopwords gone,
 * stems applied) and ORs them; each is quoted so URLs and apostrophes survive
 * the re-parse. `all` is websearch syntax, except that a trailing word being
 * typed also matches as a prefix, so a search box finds "share sheet" from
 * `shar` while every other term must still match. The prefix is tried against
 * the stemmed index and against the unstemmed words, because a prefix longer
 * than the stem (`runn` for "running", stem `run`) reaches no stemmed lexeme.
 */
function ftsMatch(q: string, match: SearchFilters["match"]) {
  if (match === "any") {
    const query = sql`(SELECT to_tsquery('english', coalesce(string_agg(quote_literal(lexeme), ' | '), ''))
                       FROM unnest(to_tsvector('english', ${q})))`;
    return { where: sql`c.search @@ ${query}`, rank: query };
  }
  const m = TRAILING_WORD.exec(q.trim());
  const openQuote = (q.match(/"/g)?.length ?? 0) % 2 === 1;
  if (!m || openQuote || /(^|\s)or\s+$/i.test(m[1]!)) {
    const query = sql`websearch_to_tsquery('english', ${q})`;
    return { where: sql`c.search @@ ${query}`, rank: query };
  }
  const rest = sql`websearch_to_tsquery('english', ${m[1]!})`;
  const stem = sql`to_tsquery('english', quote_literal(${m[2]!}) || ':*')`;
  const raw = sql`to_tsquery('simple', quote_literal(${m[2]!}) || ':*')`;
  return {
    // No other terms: `rest` constrains nothing. A stopword as the last word (empty `stem`) drops
    // out like websearch drops it, unless it is the only word: then it is a prefix being typed.
    where: sql`(numnode(${rest}) = 0 OR c.search @@ ${rest})
      AND ((numnode(${stem}) = 0 AND numnode(${rest}) > 0) OR c.search @@ ${stem}
           OR to_tsvector('simple', coalesce(c.title,'') || ' ' || coalesce(c.body,'')) @@ ${raw})`,
    rank: sql`(${rest} && ${stem})`,
  };
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
  const { where, rank } = ftsMatch(q, filters.match);
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           ts_rank(c.search, ${rank}) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND ${where}
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
 * Hybrid: FTS and semantic in parallel, fused with RRF. When embeddings are
 * not configured semantic drops out and `degraded` is set.
 */
export async function searchHybrid(
  q: string,
  filters: SearchFilters = {},
): Promise<HybridResult> {
  const semantic = workersAiConfigured();
  const lists = await Promise.all([
    searchFts(q, filters),
    ...(semantic ? [searchSemantic(q, filters)] : []),
  ]);
  const fused = lists.length === 1 ? lists[0]! : reciprocalRankFusion(lists);
  const limit = filters.limit ?? 50;
  return { hits: fused.slice(0, limit), degraded: !semantic };
}
