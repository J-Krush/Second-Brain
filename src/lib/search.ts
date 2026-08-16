import { sql } from "drizzle-orm";
import { db } from "@/db";

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
 * Quick switcher: pg_trgm similarity on title for typo-tolerant, as-you-type
 * matches. Uses the cards_title_trgm GIN index via the `%` operator.
 */
export async function searchQuick(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 20;
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           word_similarity(${q}, coalesce(c.title,'')) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND word_similarity(${q}, coalesce(c.title,'')) > 0.2
      ${typeFragment(filters.type)}
      ${tagFragment(filters.tagId)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as SearchHit[];
}

/**
 * Full-text: websearch_to_tsquery against the generated `search` column,
 * ranked with ts_rank (title weight A already outranks body weight B).
 */
export async function searchFts(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const limit = filters.limit ?? 50;
  const rows = await db.execute(sql`
    SELECT c.id, c.type, c.title, c.body, c.url,
           c.created_at AS "createdAt",
           ts_rank(c.search, websearch_to_tsquery('english', ${q})) AS score
    FROM cards c
    WHERE c.deleted_at IS NULL
      AND c.search @@ websearch_to_tsquery('english', ${q})
      ${typeFragment(filters.type)}
      ${tagFragment(filters.tagId)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as SearchHit[];
}
