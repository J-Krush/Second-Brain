import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { addPlacement } from "@/lib/boards";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  cardId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
  w: z.number().nullable().optional(),
  h: z.number().nullable().optional(),
  z: z.number().int().optional(),
});

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("cardId, x, y required");
  const { cardId, ...rest } = parsed.data;
  const placement = await addPlacement(id, cardId, rest);
  return NextResponse.json({ placement }, { status: 201 });
}
