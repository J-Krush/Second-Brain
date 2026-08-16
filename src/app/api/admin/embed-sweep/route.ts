import { NextResponse, type NextRequest } from "next/server";
import { sweepStaleEmbeddings } from "@/lib/embeddings";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const embedded = await sweepStaleEmbeddings(200);
  return NextResponse.json({ embedded });
}
