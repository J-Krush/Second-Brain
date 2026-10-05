import { NextResponse, type NextRequest } from "next/server";
import { listFacets } from "@/lib/cards";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const view = request.nextUrl.searchParams.get("view") === "library" ? "library" : "inbox";
  return NextResponse.json(await listFacets(view));
}
