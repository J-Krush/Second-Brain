import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { captureLink } from "@/lib/og";
import { embedCard } from "@/lib/embeddings";
import { createCard, listCards } from "@/lib/cards";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";
import { parseSourceKey } from "@/lib/source";
import { csv } from "@/lib/card-url";

export const runtime = "nodejs";

const createSchema = z.object({
  type: z.string().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  if (!(await authorize(request, "capture"))) return unauthorized();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid");
  const card = await createCard(parsed.data);
  if (card.type === "link" && card.url) {
    after(() => captureLink(card.id, card.url!));
  }
  after(() => embedCard(card.id));
  return NextResponse.json({ card }, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view") === "library" ? "library" : "inbox";
  const result = await listCards({
    view,
    types: csv(sp.get("type")),
    tagIds: csv(sp.get("tag")).map(Number).filter(Number.isInteger),
    sources: csv(sp.get("source")).flatMap((k) => parseSourceKey(k) ?? []),
    order: sp.get("order") === "asc" ? "asc" : "desc",
    cursor: sp.get("cursor") ?? undefined,
  });
  return NextResponse.json(result);
}
