import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { removePlacement, updatePlacement } from "@/lib/boards";
import { authorize, badRequest, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; cardId: string }> };

const schema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().nullable().optional(),
  h: z.number().nullable().optional(),
  z: z.number().int().optional(),
});

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id, cardId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("invalid placement");
  const ok = await updatePlacement(id, cardId, parsed.data);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id, cardId } = await params;
  const ok = await removePlacement(id, cardId);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
