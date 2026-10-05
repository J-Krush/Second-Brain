import { NextResponse, type NextRequest } from "next/server";
import { listEdgeLabels } from "@/lib/edges";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  return NextResponse.json({ labels: await listEdgeLabels() });
}
