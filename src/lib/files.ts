import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { files } from "@/db/schema";
import type { FileRow } from "@/db/schema";
import {
  deleteByPrefix,
  getObjectBytes,
  headObject,
  presignGet,
  presignPut,
  putObject,
} from "./r2";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

const THUMB_WIDTHS = [400, 1200] as const;

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function originalKey(row: Pick<FileRow, "r2Prefix" | "mime">): string {
  return `${row.r2Prefix}original.${extForMime(row.mime)}`;
}

export type VariantName = "original" | "thumb-400" | "thumb-1200";

function variantKey(row: FileRow, variant: VariantName): string {
  if (variant === "original") return originalKey(row);
  return `${row.r2Prefix}${variant}.webp`;
}

export interface PresignResult {
  fileId: string;
  existing: boolean;
  uploadUrl?: string;
}

/**
 * Dedupe by sha256: an already-active identical file short-circuits with no
 * upload. Otherwise a pending row is created and a presigned PUT returned.
 */
export async function presignUpload(input: {
  sha256: string;
  mime: string;
  bytes: number;
}): Promise<PresignResult> {
  const [existing] = await db
    .select()
    .from(files)
    .where(eq(files.sha256, input.sha256))
    .limit(1);
  if (existing && existing.status === "active") {
    return { fileId: existing.id, existing: true };
  }
  // Reuse a stale pending row for the same bytes, or make a new one.
  const row =
    existing ??
    (
      await db
        .insert(files)
        .values({
          r2Prefix: "", // set below once id is known
          mime: input.mime,
          bytes: input.bytes,
          sha256: input.sha256,
          status: "pending",
        })
        .returning()
    )[0]!;

  if (!row.r2Prefix) {
    row.r2Prefix = `files/${row.id}/`;
    await db.update(files).set({ r2Prefix: row.r2Prefix }).where(eq(files.id, row.id));
  }

  const uploadUrl = await presignPut(originalKey(row), input.mime);
  return { fileId: row.id, existing: false, uploadUrl };
}

/**
 * Verify the object landed, derive dimensions, generate webp thumbnails for
 * images, then flip the row to active. Never trusts the client's byte count.
 */
export async function confirmUpload(fileId: string): Promise<FileRow | null> {
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row) return null;
  if (row.status === "active") return row;

  const head = await headObject(originalKey(row));
  if (!head) return null; // upload never completed

  let width: number | null = null;
  let height: number | null = null;

  if (isImage(row.mime)) {
    const bytes = await getObjectBytes(originalKey(row));
    if (bytes) {
      const meta = await sharp(bytes).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      for (const w of THUMB_WIDTHS) {
        const thumb = await sharp(bytes)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        await putObject(`${row.r2Prefix}thumb-${w}.webp`, thumb, "image/webp");
      }
    }
  }

  const [updated] = await db
    .update(files)
    .set({ status: "active", bytes: head.size, width, height })
    .where(eq(files.id, fileId))
    .returning();
  return updated ?? null;
}

export async function getVariantUrl(
  fileId: string,
  variant: VariantName,
): Promise<string | null> {
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!row || row.status !== "active") return null;
  // Non-images have no thumbnails; fall back to the original.
  const effective = variant !== "original" && !isImage(row.mime) ? "original" : variant;
  return presignGet(variantKey(row, effective));
}

export async function deleteFileObjects(prefix: string): Promise<number> {
  return deleteByPrefix(prefix);
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const MAX_INGEST_BYTES = 10 * 1024 * 1024;

/**
 * Ingest raw image bytes we already hold server-side (share target, OG image
 * cache): dedupe by sha256, store the original, generate thumbnails, activate.
 * Returns the file id, or null on rejection.
 */
export async function ingestImageBytes(
  buf: Buffer,
  mime: string,
): Promise<string | null> {
  if (!isImage(mime) || buf.length === 0 || buf.length > MAX_INGEST_BYTES) {
    return null;
  }
  const sha = sha256Hex(buf);
  const [existing] = await db
    .select()
    .from(files)
    .where(eq(files.sha256, sha))
    .limit(1);
  if (existing?.status === "active") return existing.id;

  const row =
    existing ??
    (
      await db
        .insert(files)
        .values({ r2Prefix: "", mime, bytes: buf.length, sha256: sha, status: "pending" })
        .returning()
    )[0]!;
  if (!row.r2Prefix) {
    row.r2Prefix = `files/${row.id}/`;
    await db.update(files).set({ r2Prefix: row.r2Prefix }).where(eq(files.id, row.id));
  }
  await putObject(`${row.r2Prefix}original.${extForMime(mime)}`, buf, mime);
  await confirmUpload(row.id);
  return row.id;
}
