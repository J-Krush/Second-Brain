import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCardDetail, softDeleteCard, updateCard } from "@/lib/cards";
import { captureLink } from "@/lib/og";
import { embedCard } from "@/lib/embeddings";
import { authorize, badRequest, notFound, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const detail = await getCardDetail(id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

const patchSchema = z.object({
  type: z.string().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  triaged: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid");
  const card = await updateCard(id, parsed.data);
  if (!card) return notFound();
  // Re-fetch the OG preview when the link target or type just changed.
  if (
    card.type === "link" &&
    card.url &&
    (parsed.data.url !== undefined || parsed.data.type !== undefined)
  ) {
    after(() => captureLink(card.id, card.url!));
  }
  // Re-embed when the embeddable text changed (embedCard hash-guards no-ops).
  if (parsed.data.title !== undefined || parsed.data.body !== undefined) {
    after(() => embedCard(card.id));
  }
  return NextResponse.json({ card });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  if (!(await authorize(request))) return unauthorized();
  const { id } = await params;
  const ok = await softDeleteCard(id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
