import { NextResponse, type NextRequest } from "next/server";
import { runGc } from "@/lib/gc";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const result = await runGc();
  return NextResponse.json(result);
}

// Vercel cron issues GET with the CRON_SECRET bearer.
export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const result = await runGc();
  return NextResponse.json(result);
}
