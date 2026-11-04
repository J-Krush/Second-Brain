import { NextResponse, type NextRequest } from "next/server";
import { getVariantUrl, openOriginal, type VariantName } from "@/lib/files";
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
  // Same-origin bytes for in-browser decoding (transcription): presigned R2 URLs have no CORS headers.
  if (resolved === "original" && request.nextUrl.searchParams.get("proxy") === "1") {
    const object = await openOriginal(id);
    if (!object) return notFound();
    const headers: Record<string, string> = {
      "content-type": object.mime,
      "cache-control": "private, no-store",
    };
    if (object.size) headers["content-length"] = object.size;
    return new Response(object.body, { headers });
  }
  const url = await getVariantUrl(id, resolved);
  if (!url) return notFound();
  // Redirect to a short-TTL presigned GET; the bucket itself stays private.
  return NextResponse.redirect(url, 302);
}
