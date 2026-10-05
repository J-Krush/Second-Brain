import { NextResponse, type NextRequest } from "next/server";
import { countInbox } from "@/lib/cards";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  return NextResponse.json({ inbox: await countInbox() });
}
