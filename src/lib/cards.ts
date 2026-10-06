import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { cardTags, cards, edges, fileRefs, files, placements, tags } from "@/db/schema";
import { syncInlineRefs } from "./filerefs";
import { canonicalUrl } from "./link-url";
import { sourceFacetLabel, sourceOf, type SourceFilter } from "./source";

// Columns safe to ship to the client: excludes the 1024-float `embedding` and
// the internal generated `search` tsvector. Used for every read + returning().
export const cardCols = {
  id: cards.id,
  type: cards.type,
  title: cards.title,
  body: cards.body,
  url: cards.url,
  props: cards.props,
  createdAt: cards.createdAt,
  updatedAt: cards.updatedAt,
  deletedAt: cards.deletedAt,
  embeddingHash: cards.embeddingHash,
  embeddedAt: cards.embeddedAt,
  triagedAt: cards.triagedAt,
} as const;

export type CardView = {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  url: string | null;
  props: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  embeddingHash: string | null;
  embeddedAt: Date | null;
  triagedAt: Date | null;
};
export const CARD_TYPES: Record<string, true> = {
  thought: true,
  quote: true,
  link: true,
  video: true,
  document: true,
  project: true,
  board: true,
  mantra: true,
};

export interface CreateCardInput {
  type?: string;
  title?: string | null;
  body?: string | null;
  url?: string | null;
  props?: Record<string, unknown>;
}

export async function createCard(input: CreateCardInput): Promise<CardView> {
  const type = input.type && CARD_TYPES[input.type] ? input.type : "thought";
  const url = input.url ? canonicalUrl(input.url) : null;
  const [row] = await db
    .insert(cards)
    .values({
      type,
      title: input.title ?? null,
      body: input.body ?? null,
      url,
      props: withSource(input.props ?? {}, url),
    })
    .returning(cardCols);
  if (row!.body) await syncInlineRefs(row!.id, row!.body);
  return row!;
}

/**
 * The live card already saved for `url` (compared in canonical form), if any.
 * Lets the share sheet treat a repeat share as "already have it" instead of
 * stacking duplicates in the inbox.
 */
export async function findCardByUrl(url: string): Promise<CardView | null> {
  const [row] = await db
    .select(cardCols)
    .from(cards)
    .where(and(eq(cards.url, canonicalUrl(url)), isNull(cards.deletedAt)))
    .orderBy(desc(cards.createdAt))
    .limit(1);
  return row ?? null;
}

// Every card records provenance; callers that know better (share, upload,
// book quote) pass props.source explicitly.
function withSource(props: Record<string, unknown>, url: string | null): Record<string, unknown> {
  if (props.source !== undefined) return props;
  return { ...props, source: sourceOf({ props: {}, url }) };
}

export interface FileRef {
  id: string;
  role: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export type CardTag = { id: number; name: string; color: string | null };

export type ListCard = CardView & { tags: CardTag[]; files: FileRef[] };

export interface RelatedCard {
  id: string;
  type: string;
  title: string | null;
  body: string | null;
  label: string | null;
  description: string | null;
}

const fileRefCols = {
  cardId: fileRefs.cardId,
  id: files.id,
  role: fileRefs.role,
  mime: files.mime,
  bytes: files.bytes,
  width: files.width,
  height: files.height,
} as const;

async function filesFor(cardIds: string[]): Promise<Map<string, FileRef[]>> {
  const out = new Map<string, FileRef[]>();
  if (cardIds.length === 0) return out;
  const rows = await db
    .select(fileRefCols)
    .from(fileRefs)
    .innerJoin(files, eq(files.id, fileRefs.fileId))
    .where(and(inArray(fileRefs.cardId, cardIds), eq(files.status, "active")))
    .orderBy(asc(files.createdAt));
  for (const { cardId, ...f } of rows) {
    const list = out.get(cardId);
    if (list) list.push(f);
    else out.set(cardId, [f]);
  }
  return out;
}

async function tagsFor(cardIds: string[]): Promise<Map<string, CardTag[]>> {
  const out = new Map<string, CardTag[]>();
  if (cardIds.length === 0) return out;
  const rows = await db
    .select({ cardId: cardTags.cardId, id: tags.id, name: tags.name, color: tags.color })
    .from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId))
    .where(inArray(cardTags.cardId, cardIds))
    .orderBy(asc(tags.name));
  for (const { cardId, ...t } of rows) {
    const list = out.get(cardId);
    if (list) list.push(t);
    else out.set(cardId, [t]);
  }
  return out;
}

export interface ListParams {
  view: "inbox" | "library";
  /** Within one facet values are OR'd; facets are AND'd together. */
  types?: string[];
  tagIds?: number[];
  sources?: SourceFilter[];
  order?: "asc" | "desc"; // created_at; default desc (newest first)
  limit?: number;
  cursor?: string; // "<iso>|<uuid>"
}

function scopeFilters(view: ListParams["view"]) {
  const filters = [isNull(cards.deletedAt)];
  if (view === "inbox") filters.push(isNull(cards.triagedAt));
  return filters;
}

export interface ListResult {
  items: ListCard[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

export async function listCards(params: ListParams): Promise<ListResult> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 200);
  const filters = scopeFilters(params.view);
  if (params.sources?.length) {
    filters.push(
      or(
        ...params.sources.map((s) =>
          s.via === "web"
            ? sql`${cards.props} #>> '{source,via}' = 'web' AND ${cards.props} #>> '{source,domain}' = ${s.domain}`
            : sql`${cards.props} #>> '{source,via}' = ${s.via}`,
        ),
      )!,
    );
  }
  const types = params.types?.filter((t) => CARD_TYPES[t]) ?? [];
  if (types.length) filters.push(inArray(cards.type, types));
  if (params.tagIds?.length) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id = ${cards.id} AND ct.tag_id = ANY(${params.tagIds}::int[]))`,
    );
  }
  if (params.cursor) {
    const [iso, id] = params.cursor.split("|");
    if (iso && id) {
      // Keyset pagination on the (created_at, id) tuple, matching the
      // cards_inbox_idx ordering; comparison direction follows the sort.
      filters.push(
        params.order === "asc"
          ? sql`(${cards.createdAt}, ${cards.id}) > (${iso}::timestamptz, ${id}::uuid)`
          : sql`(${cards.createdAt}, ${cards.id}) < (${iso}::timestamptz, ${id}::uuid)`,
      );
    }
  }

  const rows = await db
    .select(cardCols)
    .from(cards)
    .where(and(...filters))
    .orderBy(
      ...(params.order === "asc"
        ? [asc(cards.createdAt), asc(cards.id)]
        : [desc(cards.createdAt), desc(cards.id)]),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
  const ids = page.map((c) => c.id);
  const [tagMap, fileMap] = await Promise.all([tagsFor(ids), filesFor(ids)]);
  const items = page.map((c) => ({
    ...c,
    tags: tagMap.get(c.id) ?? [],
    files: fileMap.get(c.id) ?? [],
  }));
  return { items, nextCursor };
}

export interface Facets {
  kinds: { type: string; count: number }[];
  sources: { key: string; label: string; via: SourceFilter["via"]; domain: string | null; count: number }[];
}

/** Counts behind the filter menus, scoped to inbox or library only. */
export async function listFacets(view: ListParams["view"]): Promise<Facets> {
  const where = and(...scopeFilters(view));
  const [kindRows, sourceRows] = await Promise.all([
    db
      .select({ type: cards.type, count: sql<number>`count(*)::int` })
      .from(cards)
      .where(where)
      .groupBy(cards.type)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        via: sql<string | null>`${cards.props} #>> '{source,via}'`,
        domain: sql<string | null>`CASE WHEN ${cards.props} #>> '{source,via}' = 'web' THEN ${cards.props} #>> '{source,domain}' END`,
        count: sql<number>`count(*)::int`,
      })
      .from(cards)
      .where(where)
      .groupBy(sql`1`, sql`2`)
      .orderBy(desc(sql`count(*)`)),
  ]);
  const sources: Facets["sources"] = [];
  for (const row of sourceRows) {
    const filter: SourceFilter | null =
      row.via === "web"
        ? row.domain
          ? { via: "web", domain: row.domain }
          : null
        : row.via === "typed" || row.via === "share" || row.via === "upload" || row.via === "book"
          ? { via: row.via }
          : null;
    if (!filter) continue;
    sources.push({
      key: filter.via === "web" ? `web:${filter.domain}` : filter.via,
      label: sourceFacetLabel(filter),
      via: filter.via,
      domain: filter.via === "web" ? filter.domain : null,
      count: row.count,
    });
  }
  return { kinds: kindRows.filter((k) => CARD_TYPES[k.type]), sources };
}

export interface CardDetail {
  card: CardView;
  tags: CardTag[];
  boards: { id: string; title: string | null }[]; // boards this card appears on
  files: FileRef[];
  links: RelatedCard[]; // outgoing
  backlinks: RelatedCard[];
}

export async function getCardDetail(id: string): Promise<CardDetail | null> {
  const [card] = await db.select(cardCols).from(cards).where(eq(cards.id, id)).limit(1);
  if (!card || card.deletedAt) return null;

  const cardTagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId))
    .where(eq(cardTags.cardId, id));

  const boardRows = await db
    .select({ id: cards.id, title: cards.title })
    .from(placements)
    .innerJoin(cards, eq(cards.id, placements.boardId))
    .where(and(eq(placements.cardId, id), isNull(cards.deletedAt)));

  // Outgoing links: cards this one points AT.
  const linkRows = await db
    .select({ id: cards.id, type: cards.type, title: cards.title, body: cards.body, label: edges.label, description: edges.description })
    .from(edges)
    .innerJoin(cards, eq(cards.id, edges.toCard))
    .where(and(eq(edges.fromCard, id), isNull(cards.deletedAt)));

  // Backlinks: cards that link TO this one.
  const backlinkRows = await db
    .select({ id: cards.id, type: cards.type, title: cards.title, body: cards.body, label: edges.label, description: edges.description })
    .from(edges)
    .innerJoin(cards, eq(cards.id, edges.fromCard))
    .where(and(eq(edges.toCard, id), isNull(cards.deletedAt)));

  const fileMap = await filesFor([id]);

  return {
    card,
    tags: cardTagRows,
    boards: boardRows,
    files: fileMap.get(id) ?? [],
    links: linkRows,
    backlinks: backlinkRows,
  };
}

export interface UpdateCardInput {
  type?: string;
  title?: string | null;
  body?: string | null;
  url?: string | null;
  props?: Record<string, unknown>;
  triaged?: boolean;
}

export async function updateCard(
  id: string,
  input: UpdateCardInput,
): Promise<CardView | null> {
  const patch: Partial<typeof cards.$inferInsert> = { updatedAt: new Date() };
  if (input.type !== undefined && CARD_TYPES[input.type]) patch.type = input.type;
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.url !== undefined) patch.url = input.url ? canonicalUrl(input.url) : input.url;
  if (input.props !== undefined) patch.props = input.props;
  if (input.triaged !== undefined) patch.triagedAt = input.triaged ? new Date() : null;

  const [row] = await db
    .update(cards)
    .set(patch)
    .where(and(eq(cards.id, id), isNull(cards.deletedAt)))
    .returning(cardCols);
  if (row && input.body !== undefined) await syncInlineRefs(row.id, input.body);
  return row ?? null;
}

/** Filing a card (tag, board placement) takes it out of the inbox; idempotent. */
export async function markTriaged(id: string): Promise<void> {
  await db
    .update(cards)
    .set({ triagedAt: sql`now()` })
    .where(and(eq(cards.id, id), isNull(cards.triagedAt)));
}

/** Untriaged, undeleted cards — the header's inbox badge. */
export async function countInbox(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cards)
    .where(and(isNull(cards.deletedAt), isNull(cards.triagedAt)));
  return row?.n ?? 0;
}

export async function softDeleteCard(id: string): Promise<boolean> {
  const [row] = await db
    .update(cards)
    .set({ deletedAt: new Date() })
    .where(and(eq(cards.id, id), isNull(cards.deletedAt)))
    .returning({ id: cards.id });
  return row !== undefined;
}
