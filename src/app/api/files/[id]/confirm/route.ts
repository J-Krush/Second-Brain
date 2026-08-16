import { NextResponse, type NextRequest } from "next/server";
import { confirmUpload } from "@/lib/files";
import { authorize, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const file = await confirmUpload(id);
  if (!file) return notFound();
  return NextResponse.json({ file });
}
