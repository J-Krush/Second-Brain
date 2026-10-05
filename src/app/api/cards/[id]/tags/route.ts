import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { markTriaged } from "@/lib/cards";
import { attachTag, detachTag } from "@/lib/tags";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  tagId: z.number().int(),
  action: z.enum(["attach", "detach"]),
});

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("tagId and action required");
  if (parsed.data.action === "attach") {
    await attachTag(id, parsed.data.tagId);
    await markTriaged(id);
  } else {
    await detachTag(id, parsed.data.tagId);
  }
  return NextResponse.json({ ok: true });
}
