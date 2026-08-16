import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { presignUpload } from "@/lib/files";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

const schema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("sha256, mime, bytes required");
  const result = await presignUpload(parsed.data);
  return NextResponse.json(result);
}
