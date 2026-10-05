import { NextResponse, type NextRequest } from "next/server";
import { reconcile } from "@/lib/gc";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const result = await reconcile();
  return NextResponse.json(result);
}
