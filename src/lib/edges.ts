import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { edges } from "@/db/schema";

/**
 * Explicit card-to-card links. Boards sync these from arrows drawn between
 * card shapes; they surface as "linked cards" on the card view.
 */
export async function upsertEdge(
  fromCard: string,
  toCard: string,
  label?: string | null,
): Promise<void> {
  if (fromCard === toCard) return;
  await db
    .insert(edges)
    .values({ fromCard, toCard, label: label || null })
    .onConflictDoUpdate({
      target: [edges.fromCard, edges.toCard],
      set: { label: label || null },
    });
}

export async function deleteEdge(fromCard: string, toCard: string): Promise<boolean> {
  const [row] = await db
    .delete(edges)
    .where(and(eq(edges.fromCard, fromCard), eq(edges.toCard, toCard)))
    .returning({ fromCard: edges.fromCard });
  return row !== undefined;
}
