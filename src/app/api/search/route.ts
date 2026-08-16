import { NextResponse, type NextRequest } from "next/server";
import { embeddingsConfigured } from "@/lib/embeddings";
import {
  searchFts,
  searchHybrid,
  searchQuick,
  searchSemantic,
  type SearchFilters,
  type SearchMode,
} from "@/lib/search";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

const MODES: Record<string, SearchMode> = {
  quick: "quick",
  fts: "fts",
  semantic: "semantic",
  hybrid: "hybrid",
};

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const mode = MODES[sp.get("mode") ?? "hybrid"] ?? "hybrid";
  if (!q) return NextResponse.json({ mode, hits: [], degraded: false });

  const tagIdRaw = sp.get("tag");
  const filters: SearchFilters = {
    type: sp.get("type") ?? undefined,
    tagId: tagIdRaw ? Number(tagIdRaw) : undefined,
  };

  // Semantic requires embeddings; without a key, say so rather than fake it.
  if (mode === "semantic" && !embeddingsConfigured()) {
    return NextResponse.json(
      { error: "embeddings not configured", mode, hits: [] },
      { status: 503 },
    );
  }

  if (mode === "quick") {
    return NextResponse.json({ mode, hits: await searchQuick(q, filters), degraded: false });
  }
  if (mode === "fts") {
    return NextResponse.json({ mode, hits: await searchFts(q, filters), degraded: false });
  }
  if (mode === "semantic") {
    return NextResponse.json({ mode, hits: await searchSemantic(q, filters), degraded: false });
  }
  const result = await searchHybrid(q, filters);
  return NextResponse.json({ mode, hits: result.hits, degraded: result.degraded });
}
