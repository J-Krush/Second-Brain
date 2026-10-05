import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
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
  description?: string | null,
): Promise<void> {
  if (fromCard === toCard) return;
  // `undefined` description leaves an existing one alone (board arrow sync
  // only knows labels); explicit null clears it.
  const values = { fromCard, toCard, label: label || null, description: description || null };
  await db
    .insert(edges)
    .values(values)
    .onConflictDoUpdate({
      target: [edges.fromCard, edges.toCard],
      set: description === undefined ? { label: values.label } : { label: values.label, description: values.description },
    });
}

/** Distinct relation labels, most used first (for label autocomplete). */
export async function listEdgeLabels(): Promise<string[]> {
  const rows = await db
    .select({ label: edges.label })
    .from(edges)
    .where(isNotNull(edges.label))
    .groupBy(edges.label)
    .orderBy(desc(sql`count(*)`), edges.label);
  return rows.map((r) => r.label!);
}

export async function deleteEdge(fromCard: string, toCard: string): Promise<boolean> {
  const [row] = await db
    .delete(edges)
    .where(and(eq(edges.fromCard, fromCard), eq(edges.toCard, toCard)))
    .returning({ fromCard: edges.fromCard });
  return row !== undefined;
}
