import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { cardTags, cards, edges, placements, tags } from "@/db/schema";
import { syncInlineRefs } from "./filerefs";

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
  const [row] = await db
    .insert(cards)
    .values({
      type,
      title: input.title ?? null,
      body: input.body ?? null,
      url: input.url ?? null,
      props: input.props ?? {},
    })
    .returning(cardCols);
  if (row!.body) await syncInlineRefs(row!.id, row!.body);
  return row!;
}

export interface ListParams {
  view: "inbox" | "library";
  type?: string;
  tagId?: number;
  order?: "asc" | "desc"; // created_at; default desc (newest first)
  limit?: number;
  cursor?: string; // "<iso>|<uuid>"
}

export interface ListResult {
  items: CardView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

export async function listCards(params: ListParams): Promise<ListResult> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 200);
  const filters = [isNull(cards.deletedAt)];
  if (params.type && CARD_TYPES[params.type]) {
    filters.push(eq(cards.type, params.type));
  }
  if (params.tagId !== undefined) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id = ${cards.id} AND ct.tag_id = ${params.tagId})`,
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
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor };
}

export interface CardDetail {
  card: CardView;
  tags: { id: number; name: string; color: string | null }[];
  boards: { id: string; title: string | null }[]; // boards this card appears on
  links: { id: string; type: string; title: string | null; body: string | null; label: string | null }[]; // outgoing
  backlinks: { id: string; type: string; title: string | null; body: string | null; label: string | null }[];
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
    .select({ id: cards.id, type: cards.type, title: cards.title, body: cards.body, label: edges.label })
    .from(edges)
    .innerJoin(cards, eq(cards.id, edges.toCard))
    .where(and(eq(edges.fromCard, id), isNull(cards.deletedAt)));

  // Backlinks: cards that link TO this one.
  const backlinkRows = await db
    .select({ id: cards.id, type: cards.type, title: cards.title, body: cards.body, label: edges.label })
    .from(edges)
    .innerJoin(cards, eq(cards.id, edges.fromCard))
    .where(and(eq(edges.toCard, id), isNull(cards.deletedAt)));

  return {
    card,
    tags: cardTagRows,
    boards: boardRows,
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
}

export async function updateCard(
  id: string,
  input: UpdateCardInput,
): Promise<CardView | null> {
  const patch: Partial<typeof cards.$inferInsert> = { updatedAt: new Date() };
  if (input.type !== undefined && CARD_TYPES[input.type]) patch.type = input.type;
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.url !== undefined) patch.url = input.url;
  if (input.props !== undefined) patch.props = input.props;

  const [row] = await db
    .update(cards)
    .set(patch)
    .where(and(eq(cards.id, id), isNull(cards.deletedAt)))
    .returning(cardCols);
  if (row && input.body !== undefined) await syncInlineRefs(row.id, input.body);
  return row ?? null;
}

export async function softDeleteCard(id: string): Promise<boolean> {
  const [row] = await db
    .update(cards)
    .set({ deletedAt: new Date() })
    .where(and(eq(cards.id, id), isNull(cards.deletedAt)))
    .returning({ id: cards.id });
  return row !== undefined;
}
