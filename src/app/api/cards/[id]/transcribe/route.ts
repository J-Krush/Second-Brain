import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCardDetail } from "@/lib/cards";
import {
  captureYoutubeCaptions,
  deleteTranscript,
  isTranscribableFile,
  startUploadTranscript,
  startYoutubeTranscript,
} from "@/lib/transcripts";
import { youtubeVideoId } from "@/lib/youtube";
import { authorize, badRequest, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const startSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("youtube") }),
  z.object({
    source: z.literal("upload"),
    fileId: z.string().uuid(),
    // 900 × 240 s chunks = 60 h, far beyond any real recording.
    totalChunks: z.number().int().min(1).max(900),
  }),
]);

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid");
  const detail = await getCardDetail(id);
  if (!detail) return notFound();

  if (parsed.data.source === "youtube") {
    const url = detail.card.url;
    if (!url || !youtubeVideoId(url)) return badRequest("card has no YouTube url");
    const transcript = await startYoutubeTranscript(id, url);
    after(() => captureYoutubeCaptions(id));
    return NextResponse.json({ transcript }, { status: 202 });
  }

  const { fileId, totalChunks } = parsed.data;
  if (!(await isTranscribableFile(id, fileId))) {
    return badRequest("file is not an audio or video attachment of this card");
  }
  const transcript = await startUploadTranscript(id, fileId, totalChunks);
  return NextResponse.json({ transcript });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  await deleteTranscript(id);
  return NextResponse.json({ ok: true });
}
