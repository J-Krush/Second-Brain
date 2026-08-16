import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, files } from "@/db/schema";
import { deleteByPrefix, deleteKeys, listPrefix } from "./r2";

export interface GcResult {
  cardsHardDeleted: number;
  pendingFilesDeleted: number;
  orphanFilesDeleted: number;
}

const CARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

async function deleteFileRows(
  rows: { id: string; r2Prefix: string }[],
): Promise<number> {
  for (const row of rows) {
    await deleteByPrefix(row.r2Prefix);
    await db.delete(files).where(eq(files.id, row.id));
  }
  return rows.length;
}

/**
 * Nightly maintenance (also a manual admin action):
 *  1. hard-delete cards soft-deleted > 30 days ago (cascades placements,
 *     edges, tags, refs). Done first so files they referenced become orphans
 *     that step 3 then reclaims in the same run.
 *  2. delete pending files older than 24h (crashed/abandoned uploads).
 *  3. delete active files with zero references.
 */
export async function runGc(): Promise<GcResult> {
  const cardCutoff = new Date(Date.now() - CARD_TTL_MS);
  const pendingCutoff = new Date(Date.now() - PENDING_TTL_MS);

  const deletedCards = await db
    .delete(cards)
    .where(and(isNotNull(cards.deletedAt), lt(cards.deletedAt, cardCutoff)))
    .returning({ id: cards.id });

  const pending = await db
    .select({ id: files.id, r2Prefix: files.r2Prefix })
    .from(files)
    .where(and(eq(files.status, "pending"), lt(files.createdAt, pendingCutoff)));
  const pendingFilesDeleted = await deleteFileRows(pending);

  // Active files no card references anymore.
  const orphans = await db
    .select({ id: files.id, r2Prefix: files.r2Prefix })
    .from(files)
    .where(
      and(
        eq(files.status, "active"),
        sql`NOT EXISTS (SELECT 1 FROM file_refs fr WHERE fr.file_id = ${files.id})`,
      ),
    );
  const orphanFilesDeleted = await deleteFileRows(orphans);

  return {
    cardsHardDeleted: deletedCards.length,
    pendingFilesDeleted,
    orphanFilesDeleted,
  };
}

export interface ReconcileResult {
  straysDeleted: number;
  strayKeys: string[];
}

/**
 * List every object under files/ in R2 and delete keys whose file id has no
 * row in the DB. Catches bytes stranded by crashes/bugs.
 */
export async function reconcile(): Promise<ReconcileResult> {
  const keys = await listPrefix("files/");
  if (keys.length === 0) return { straysDeleted: 0, strayKeys: [] };

  const known = await db.select({ id: files.id }).from(files);
  const knownIds = new Set(known.map((r) => r.id));

  // Keys look like files/{id}/original.ext ; the id is the second segment.
  const strays = keys.filter((key) => {
    const id = key.split("/")[1];
    return id ? !knownIds.has(id) : true;
  });

  await deleteKeys(strays);
  return { straysDeleted: strays.length, strayKeys: strays };
}
