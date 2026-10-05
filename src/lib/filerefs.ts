import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { fileRefs } from "@/db/schema";

export type FileRole = "attachment" | "inline" | "cover" | "og_cache";

// Matches file references embedded in markdown, e.g. ![alt](file:UUID) or a
// bare file:UUID link. Captures the UUID.
const FILE_REF_RE =
  /file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function parseFileIds(body: string | null | undefined): string[] {
  if (!body) return [];
  const ids = new Set<string>();
  for (const m of body.matchAll(FILE_REF_RE)) {
    if (m[1]) ids.add(m[1].toLowerCase());
  }
  return [...ids];
}

/**
 * Reconcile inline file refs for a card to exactly match the ids embedded in
 * its body. Server-derived on every save; the client is never trusted to
 * report which files a card uses.
 */
export async function syncInlineRefs(
  cardId: string,
  body: string | null | undefined,
): Promise<void> {
  const wanted = parseFileIds(body);

  const current = await db
    .select({ fileId: fileRefs.fileId })
    .from(fileRefs)
    .where(and(eq(fileRefs.cardId, cardId), eq(fileRefs.role, "inline")));
  const currentIds = new Set(current.map((r) => r.fileId));
  const wantedIds = new Set(wanted);

  const toAdd = wanted.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wantedIds.has(id));

  if (toAdd.length > 0) {
    await db
      .insert(fileRefs)
      .values(toAdd.map((fileId) => ({ fileId, cardId, role: "inline" as const })))
      .onConflictDoNothing();
  }
  if (toRemove.length > 0) {
    await db
      .delete(fileRefs)
      .where(
        and(
          eq(fileRefs.cardId, cardId),
          eq(fileRefs.role, "inline"),
          inArray(fileRefs.fileId, toRemove),
        ),
      );
  }
}

export async function setRef(
  fileId: string,
  cardId: string,
  role: FileRole,
): Promise<void> {
  await db
    .insert(fileRefs)
    .values({ fileId, cardId, role })
    .onConflictDoNothing();
}

export async function clearRole(cardId: string, role: FileRole): Promise<void> {
  await db
    .delete(fileRefs)
    .where(and(eq(fileRefs.cardId, cardId), eq(fileRefs.role, role)));
}
