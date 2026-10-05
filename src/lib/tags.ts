import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cardTags, tags } from "@/db/schema";

export type Tag = typeof tags.$inferSelect;

export async function listTags(): Promise<(Tag & { count: number })[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      count: sql<number>`count(${cardTags.cardId})::int`,
    })
    .from(tags)
    .leftJoin(cardTags, eq(cardTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
  return rows;
}

export async function createTag(name: string, color?: string | null): Promise<Tag> {
  const [row] = await db
    .insert(tags)
    .values({ name, color: color ?? null })
    .onConflictDoUpdate({ target: tags.name, set: { name } })
    .returning();
  return row!;
}

export async function renameTag(
  id: number,
  name: string,
  color?: string | null,
): Promise<Tag | null> {
  const patch: Partial<typeof tags.$inferInsert> = { name };
  if (color !== undefined) patch.color = color;
  const [row] = await db.update(tags).set(patch).where(eq(tags.id, id)).returning();
  return row ?? null;
}

export async function deleteTag(id: number): Promise<boolean> {
  const [row] = await db
    .delete(tags)
    .where(eq(tags.id, id))
    .returning({ id: tags.id });
  return row !== undefined;
}

export async function attachTag(cardId: string, tagId: number): Promise<void> {
  await db
    .insert(cardTags)
    .values({ cardId, tagId })
    .onConflictDoNothing();
}

export async function detachTag(cardId: string, tagId: number): Promise<void> {
  await db
    .delete(cardTags)
    .where(sql`${cardTags.cardId} = ${cardId} AND ${cardTags.tagId} = ${tagId}`);
}
