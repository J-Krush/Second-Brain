import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { askSettingsSchema, DEFAULT_ASK_SETTINGS, type AskSettings } from "./ask-config";

const ASK_KEY = "ask";

/**
 * Stored document run through the schema so missing keys get defaults; a
 * document that no longer validates (schema tightened) falls back to
 * defaults rather than breaking /ask.
 */
export async function getAskSettings(): Promise<AskSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ASK_KEY)).limit(1);
  if (!row) return DEFAULT_ASK_SETTINGS;
  const parsed = askSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_ASK_SETTINGS;
}

/** Validated merge of `patch` over the current document; returns the result. */
export async function updateAskSettings(patch: Partial<AskSettings>): Promise<AskSettings> {
  const current = await getAskSettings();
  const next = askSettingsSchema.parse({ ...current, ...patch });
  await db
    .insert(settings)
    .values({ key: ASK_KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: sql`now()` } });
  return next;
}
