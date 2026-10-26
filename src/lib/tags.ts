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

export interface RenameResult {
  tag: Tag;
  /** The name belonged to another tag: cards moved onto it and the renamed tag is gone. */
  merged: boolean;
}

/**
 * Renames a tag everywhere it is attached. Renaming onto a name another tag
 * already has (case-insensitively, so `prepping` → `Prepping`) merges the two.
 */
export async function renameTag(
  id: number,
  name: string,
  color?: string | null,
): Promise<RenameResult | null> {
  const [target] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) = lower(${name}) AND ${tags.id} <> ${id}`)
    .limit(1);
  if (!target) {
    const patch: Partial<typeof tags.$inferInsert> = { name };
    if (color !== undefined) patch.color = color;
    const [row] = await db.update(tags).set(patch).where(eq(tags.id, id)).returning();
    return row ? { tag: row, merged: false } : null;
  }
  // One statement so a half-done merge can't be observed. All CTEs read the
  // pre-statement snapshot, so the source's own name is still visible to the
  // CASE that avoids a unique clash when only the source already had `name`.
  const res = await db.execute<Tag>(sql`
    WITH source AS (SELECT id, name FROM tags WHERE id = ${id}),
    moved AS (
      INSERT INTO card_tags (card_id, tag_id)
      SELECT ct.card_id, ${target.id}::int FROM card_tags ct JOIN source s ON s.id = ct.tag_id
      ON CONFLICT DO NOTHING
    ),
    gone AS (DELETE FROM tags WHERE id IN (SELECT id FROM source))
    UPDATE tags SET name = CASE WHEN ${name} = (SELECT name FROM source) THEN tags.name ELSE ${name} END
    WHERE id = ${target.id} AND EXISTS (SELECT 1 FROM source)
    RETURNING id, name, color
  `);
  const row = res.rows[0];
  return row ? { tag: row, merged: true } : null;
}

export async function deleteTag(id: number): Promise<boolean> {
  const [row] = await db
    .delete(tags)
    .where(eq(tags.id, id))
    .returning({ id: tags.id });
  return row !== undefined;
}

/** Attaches every tag id that still exists; unknown ids are skipped, not errors. */
export async function attachTags(cardId: string, tagIds: number[]): Promise<void> {
  if (tagIds.length === 0) return;
  await db.execute(
    sql`INSERT INTO card_tags (card_id, tag_id) SELECT ${cardId}::uuid, id FROM tags WHERE id IN ${tagIds} ON CONFLICT DO NOTHING`,
  );
}

export async function detachTag(cardId: string, tagId: number): Promise<void> {
  await db
    .delete(cardTags)
    .where(sql`${cardTags.cardId} = ${cardId} AND ${cardTags.tagId} = ${tagId}`);
}
