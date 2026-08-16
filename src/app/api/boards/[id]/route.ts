import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBoard, saveBoardSnapshot } from "@/lib/boards";
import { authorize, badRequest, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const board = await getBoard(id);
  if (!board) return notFound();
  return NextResponse.json(board);
}

const snapshotSchema = z.object({ snapshot: z.unknown() });

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const parsed = snapshotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("snapshot required");
  const ok = await saveBoardSnapshot(id, parsed.data.snapshot);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
