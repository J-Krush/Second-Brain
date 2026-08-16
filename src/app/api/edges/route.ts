import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deleteEdge, upsertEdge } from "@/lib/edges";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

const edgeSchema = z.object({
  fromCard: z.string().uuid(),
  toCard: z.string().uuid(),
  label: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const parsed = edgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("fromCard and toCard required");
  await upsertEdge(parsed.data.fromCard, parsed.data.toCard, parsed.data.label);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const parsed = edgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("fromCard and toCard required");
  await deleteEdge(parsed.data.fromCard, parsed.data.toCard);
  return NextResponse.json({ ok: true });
}
