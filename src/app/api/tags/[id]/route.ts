import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deleteTag, renameTag } from "@/lib/tags";
import { authorize, badRequest, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.name === undefined)
    return badRequest("name required");
  const result = await renameTag(id, parsed.data.name, parsed.data.color);
  if (!result) return notFound();
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return badRequest("invalid id");
  const ok = await deleteTag(id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
