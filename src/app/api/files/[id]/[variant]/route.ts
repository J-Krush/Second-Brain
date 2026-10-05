import { NextResponse, type NextRequest } from "next/server";
import { getVariantUrl, type VariantName } from "@/lib/files";
import { authorize, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

const VARIANTS: Record<string, VariantName> = {
  original: "original",
  "thumb-400": "thumb-400",
  "thumb-1200": "thumb-1200",
};

type Ctx = { params: Promise<{ id: string; variant: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id, variant } = await params;
  const resolved = VARIANTS[variant];
  if (!resolved) return notFound();
  const url = await getVariantUrl(id, resolved);
  if (!url) return notFound();
  // Redirect to a short-TTL presigned GET; the bucket itself stays private.
  return NextResponse.redirect(url, 302);
}
