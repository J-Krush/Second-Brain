import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createTag, listTags } from "@/lib/tags";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  return NextResponse.json({ tags: await listTags() });
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("name required");
  const tag = await createTag(parsed.data.name, parsed.data.color);
  return NextResponse.json({ tag }, { status: 201 });
}
