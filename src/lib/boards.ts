import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { cards, placements } from "@/db/schema";
import { cardCols, type CardView } from "./cards";

export interface PlacementView {
  cardId: string;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  z: number;
}

export interface BoardData {
  board: CardView;
  placements: PlacementView[];
  cards: CardView[]; // the placed cards' content
  snapshot: unknown | null; // tldraw snapshot of native (non-card) shapes
}

export async function getBoard(id: string): Promise<BoardData | null> {
  const [board] = await db.select(cardCols).from(cards).where(eq(cards.id, id)).limit(1);
  if (!board || board.deletedAt) return null;

  const placementRows = await db
    .select({
      cardId: placements.cardId,
      x: placements.x,
      y: placements.y,
      w: placements.w,
      h: placements.h,
      z: placements.z,
    })
    .from(placements)
    .where(eq(placements.boardId, id));

  const cardIds = placementRows.map((p) => p.cardId);
  const placedCards = cardIds.length
    ? await db
        .select(cardCols)
        .from(cards)
        .where(and(inArray(cards.id, cardIds), isNull(cards.deletedAt)))
    : [];

  const props = (board.props as Record<string, unknown> | null) ?? {};
  return {
    board,
    placements: placementRows,
    cards: placedCards,
    snapshot: props.tldraw ?? null,
  };
}

export async function saveBoardSnapshot(
  boardId: string,
  snapshot: unknown,
): Promise<boolean> {
  const [board] = await db
    .select({ props: cards.props })
    .from(cards)
    .where(eq(cards.id, boardId))
    .limit(1);
  if (!board) return false;
  const props = { ...((board.props as Record<string, unknown> | null) ?? {}), tldraw: snapshot };
  const [row] = await db
    .update(cards)
    .set({ props })
    .where(eq(cards.id, boardId))
    .returning({ id: cards.id });
  return row !== undefined;
}

export interface PlacementInput {
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  z?: number;
}

export async function addPlacement(
  boardId: string,
  cardId: string,
  input: PlacementInput,
): Promise<PlacementView> {
  const [row] = await db
    .insert(placements)
    .values({
      boardId,
      cardId,
      x: input.x,
      y: input.y,
      w: input.w ?? null,
      h: input.h ?? null,
      z: input.z ?? 0,
    })
    .onConflictDoUpdate({
      target: [placements.boardId, placements.cardId],
      set: { x: input.x, y: input.y, w: input.w ?? null, h: input.h ?? null },
    })
    .returning({
      cardId: placements.cardId,
      x: placements.x,
      y: placements.y,
      w: placements.w,
      h: placements.h,
      z: placements.z,
    });
  return row!;
}

export async function updatePlacement(
  boardId: string,
  cardId: string,
  input: Partial<PlacementInput>,
): Promise<boolean> {
  const patch: Partial<typeof placements.$inferInsert> = {};
  if (input.x !== undefined) patch.x = input.x;
  if (input.y !== undefined) patch.y = input.y;
  if (input.w !== undefined) patch.w = input.w;
  if (input.h !== undefined) patch.h = input.h;
  if (input.z !== undefined) patch.z = input.z;
  if (Object.keys(patch).length === 0) return true;
  const [row] = await db
    .update(placements)
    .set(patch)
    .where(and(eq(placements.boardId, boardId), eq(placements.cardId, cardId)))
    .returning({ cardId: placements.cardId });
  return row !== undefined;
}

export async function removePlacement(
  boardId: string,
  cardId: string,
): Promise<boolean> {
  const [row] = await db
    .delete(placements)
    .where(and(eq(placements.boardId, boardId), eq(placements.cardId, cardId)))
    .returning({ cardId: placements.cardId });
  return row !== undefined;
}
