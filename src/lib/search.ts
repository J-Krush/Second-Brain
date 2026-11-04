import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedText } from "./embeddings";

import { reciprocalRankFusion } from "./rrf";
import { workersAiConfigured } from "./workers-ai";

export type SearchMode = "quick" | "fts" | "semantic" | "hybrid";

/** Transcript evidence for a hit: the chunk excerpt that matched, and where it starts in the media. */
export interface SearchMatch {
  text: string;
  startMs: number | null;
}

export interface SearchHit {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  score: number;
  /** The best-matching transcript chunk, whenever one matched (even if the card's own text ranked higher). */
  match: SearchMatch | null;
}

/** Row shape returned by the fts/semantic queries; match fields stay flat so SQL can UNION them. */
interface SearchRow {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  score: number;
  match_text: string | null;
  match_start_ms: number | null;
}

function toHit({ match_text, match_start_ms, ...card }: SearchRow): SearchHit {
  return {
    ...card,
    match: match_text === null ? null : { text: match_text, startMs: match_start_ms },
  };
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
 * (thoughts/quotes usually have no title). Transcripts are not consulted, so
 * `match` is always null.
 */
export async function searchQuick(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 20;
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           NULL AS match,
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
 * Full-text: the tsquery against the card's generated `search` column and
 * every transcript chunk's. Each card ranks by its best row and carries its
 * best chunk as `match` whenever a chunk matched, so /ask and the palette see
 * the transcript evidence even when the title also hit.
 * Chunk vectors are unweighted (D) while card titles/bodies carry A/B, so
 * ts_rank already ranks a transcript-only hit below an equal card hit. The
 * headline runs only on the final page of rows because it re-parses the text.
 */
export async function searchFts(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 50;
  const query = tsquery(q, filters.match);
  const rows = await db.execute(sql`
    SELECT best.id, best.type, best.title, best.body, best.url, best."createdAt", best.score,
           ts_headline('english', best.chunk_text, ${query},
                       'MaxWords=24, MinWords=8, StartSel="", StopSel=""') AS match_text,
           best.match_start_ms
    FROM (
      SELECT * FROM (
        SELECT DISTINCT ON (hit.id)
               hit.id, hit.type, hit.title, hit.body, hit.url, hit."createdAt",
               max(hit.score) OVER (PARTITION BY hit.id) AS score,
               hit.chunk_text, hit.match_start_ms
        FROM (
          SELECT c.id, c.type, c.title, c.body, c.url,
                 c.created_at AS "createdAt",
                 ts_rank(c.search, ${query}) AS score,
                 NULL::text AS chunk_text,
                 NULL::integer AS match_start_ms
          FROM cards c
          WHERE c.deleted_at IS NULL
            AND c.search @@ ${query}
            ${typeFragment(filters.type)}
            ${tagFragment(filters.tagId)}
          UNION ALL
          SELECT c.id, c.type, c.title, c.body, c.url,
                 c.created_at AS "createdAt",
                 ts_rank(k.search, ${query}) AS score,
                 k.text AS chunk_text,
                 k.start_ms AS match_start_ms
          FROM card_chunks k
          JOIN cards c ON c.id = k.card_id
          WHERE c.deleted_at IS NULL
            AND k.search @@ ${query}
            ${typeFragment(filters.type)}
            ${tagFragment(filters.tagId)}
        ) hit
        ORDER BY hit.id, hit.chunk_text IS NULL, hit.score DESC
      ) per_card
      ORDER BY per_card.score DESC
      LIMIT ${limit}
    ) best
    ORDER BY best.score DESC
  `);
  return (rows.rows as unknown as SearchRow[]).map(toHit);
}

/**
 * Semantic: cosine distance over the card and transcript-chunk embeddings.
 * Score is similarity (1 - distance), each card ranked by its closest row and
 * carrying its closest chunk as `match` when any chunk made the cut. Each
 * branch orders and limits by `<=>` on its own so Postgres can use that
 * table's HNSW index; rows without an embedding are excluded by the NOT NULL
 * guards.
 */
export async function semanticByVector(
  vec: number[],
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 50;
  const literal = `[${vec.join(",")}]`;
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (hit.id)
             hit.id, hit.type, hit.title, hit.body, hit.url, hit."createdAt",
             max(hit.score) OVER (PARTITION BY hit.id) AS score,
             hit.match_text, hit.match_start_ms
      FROM (
        (
          SELECT c.id, c.type, c.title, c.body, c.url,
                 c.created_at AS "createdAt",
                 1 - (c.embedding <=> ${literal}::vector) AS score,
                 NULL::text AS match_text,
                 NULL::integer AS match_start_ms
          FROM cards c
          WHERE c.deleted_at IS NULL
            AND c.embedding IS NOT NULL
            ${typeFragment(filters.type)}
            ${tagFragment(filters.tagId)}
          ORDER BY c.embedding <=> ${literal}::vector
          LIMIT ${limit}
        )
        UNION ALL
        (
          SELECT c.id, c.type, c.title, c.body, c.url,
                 c.created_at AS "createdAt",
                 1 - (k.embedding <=> ${literal}::vector) AS score,
                 left(k.text, 240) AS match_text,
                 k.start_ms AS match_start_ms
          FROM card_chunks k
          JOIN cards c ON c.id = k.card_id
          WHERE c.deleted_at IS NULL
            AND k.embedding IS NOT NULL
            ${typeFragment(filters.type)}
            ${tagFragment(filters.tagId)}
          ORDER BY k.embedding <=> ${literal}::vector
          LIMIT ${limit}
        )
      ) hit
      ORDER BY hit.id, hit.match_text IS NULL, hit.score DESC
    ) best
    ORDER BY best.score DESC
    LIMIT ${limit}
  `);
  return (rows.rows as unknown as SearchRow[]).map(toHit);
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
  degraded: boolean; // true when Workers AI is unavailable (fts only)
}

/**
 * Hybrid: run FTS and semantic in parallel, fuse with RRF. RRF keeps whichever
 * copy of a card it saw last, so the transcript match is re-attached
 * afterwards, preferring the FTS one (an exact phrase hit) over the semantic
 * one. When Workers AI is not configured it degrades to FTS alone and flags
 * `degraded`.
 */
export async function searchHybrid(
  q: string,
  filters: SearchFilters = {},
): Promise<HybridResult> {
  if (!workersAiConfigured()) {
    return { hits: await searchFts(q, filters), degraded: true };
  }
  const [fts, semantic] = await Promise.all([
    searchFts(q, filters),
    searchSemantic(q, filters),
  ]);
  const matches: Record<string, SearchMatch> = {};
  for (const hit of [...semantic, ...fts]) {
    if (hit.match) matches[hit.id] = hit.match;
  }
  const limit = filters.limit ?? 50;
  const hits = reciprocalRankFusion([fts, semantic])
    .slice(0, limit)
    .map((hit) => ({ ...hit, match: matches[hit.id] ?? null }));
  return { hits, degraded: false };
}
