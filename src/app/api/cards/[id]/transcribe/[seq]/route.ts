import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTranscript, MAX_CHUNK_BYTES, storeUploadChunk } from "@/lib/transcripts";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
// One whisper call over a 240 s chunk runs inside this request.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; seq: string }> };

const ms = z.coerce.number().int().min(0);
const chunkSchema = z.object({
  seq: ms,
  startMs: ms,
  endMs: ms,
});

export async function PUT(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id, seq } = await params;
  const parsed = chunkSchema.safeParse({
    seq,
    startMs: request.headers.get("x-start-ms") ?? undefined,
    endMs: request.headers.get("x-end-ms") ?? undefined,
  });
  if (!parsed.success) return badRequest("seq, x-start-ms, x-end-ms must be non-negative integers");

  const transcript = await getTranscript(id);
  if (transcript?.source !== "upload" || transcript.status !== "running") {
    return NextResponse.json({ error: "no upload transcript in progress" }, { status: 409 });
  }
  if (transcript.totalChunks !== null && parsed.data.seq >= transcript.totalChunks) {
    return badRequest(`seq must be below ${transcript.totalChunks}`);
  }

  const tooLarge = { error: `chunk exceeds ${MAX_CHUNK_BYTES} bytes` };
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CHUNK_BYTES) {
    return NextResponse.json(tooLarge, { status: 413 });
  }
  // content-length is advisory (chunked bodies omit it), so the real size is checked too.
  const wav = new Uint8Array(await request.arrayBuffer());
  if (wav.byteLength > MAX_CHUNK_BYTES) return NextResponse.json(tooLarge, { status: 413 });
  if (wav.byteLength === 0) return badRequest("empty body");

  try {
    const { text, done } = await storeUploadChunk(
      id,
      parsed.data.seq,
      parsed.data.startMs,
      parsed.data.endMs,
      wav,
    );
    return NextResponse.json({ seq: parsed.data.seq, text, done });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "transcription failed" },
      { status: 502 },
    );
  }
}
