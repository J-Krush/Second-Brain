import { after, NextResponse, type NextRequest } from "next/server";
import { createCard } from "@/lib/cards";
import { embedCard } from "@/lib/embeddings";
import { ingestImageBytes } from "@/lib/files";
import { captureLink } from "@/lib/og";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

/**
 * PWA share-target handler. The OS share sheet POSTs title/text/url and
 * optional images here; we create a card, attach any images, and redirect
 * into the app. Authenticated by the same session cookie as the browser.
 */
export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();

  const form = await request.formData();
  const title = (form.get("title") as string | null)?.trim() || null;
  const text = (form.get("text") as string | null)?.trim() || "";
  const url = (form.get("url") as string | null)?.trim() || null;

  const sharedUrl = url ?? (/^https?:\/\/\S+$/.test(text) ? text : null);

  // Ingest shared images first so we can embed them in the body.
  const embeds: string[] = [];
  for (const entry of form.getAll("files")) {
    if (entry instanceof File && entry.type.startsWith("image/")) {
      const buf = Buffer.from(await entry.arrayBuffer());
      const fileId = await ingestImageBytes(buf, entry.type);
      if (fileId) embeds.push(`![${entry.name}](file:${fileId})`);
    }
  }

  const bodyParts: string[] = [];
  if (text && text !== sharedUrl) bodyParts.push(text);
  if (embeds.length) bodyParts.push(embeds.join("\n"));
  const body = bodyParts.join("\n\n") || null;

  const card = await createCard({
    type: sharedUrl ? "link" : "thought",
    title,
    body,
    url: sharedUrl,
  });

  if (card.type === "link" && card.url) after(() => captureLink(card.id, card.url!));
  after(() => embedCard(card.id));

  // Redirect the opened PWA window to the new card (or inbox).
  const dest = card.type === "board" ? "/" : `/cards/${card.id}`;
  return NextResponse.redirect(new URL(dest, request.url), 303);
}
