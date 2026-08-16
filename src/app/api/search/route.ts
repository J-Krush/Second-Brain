import { NextResponse, type NextRequest } from "next/server";
import { searchFts, searchQuick, type SearchFilters } from "@/lib/search";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  // quick + fts here; semantic + hybrid are added with the embedding pipeline.
  const mode = sp.get("mode") === "quick" ? "quick" : "fts";
  if (!q) return NextResponse.json({ mode, hits: [] });

  const tagIdRaw = sp.get("tag");
  const filters: SearchFilters = {
    type: sp.get("type") ?? undefined,
    tagId: tagIdRaw ? Number(tagIdRaw) : undefined,
  };

  const hits =
    mode === "quick" ? await searchQuick(q, filters) : await searchFts(q, filters);
  return NextResponse.json({ mode, hits });
}
