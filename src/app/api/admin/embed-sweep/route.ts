import { NextResponse, type NextRequest } from "next/server";
import { sweepStaleEmbeddings } from "@/lib/embeddings";
import { sweepTranscripts } from "@/lib/transcripts";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

async function sweep(request: NextRequest): Promise<NextResponse> {
  if (!(await authorize(request))) return unauthorized();
  const embedded = await sweepStaleEmbeddings(200);
  const { retried, chunksEmbedded } = await sweepTranscripts();
  return NextResponse.json({ embedded, chunksEmbedded, transcriptsRetried: retried });
}

export async function POST(request: NextRequest) {
  return sweep(request);
}

// The Cron Trigger (worker.ts `scheduled`) issues GET with the CRON_SECRET bearer.
export async function GET(request: NextRequest) {
  return sweep(request);
}
