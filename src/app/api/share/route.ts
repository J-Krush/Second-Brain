import { after, NextResponse, type NextRequest } from "next/server";
import { createCard, findCardByUrl, type CardView } from "@/lib/cards";
import { embedCard } from "@/lib/embeddings";
import { ingestImageBytes } from "@/lib/files";
import { canonicalUrl } from "@/lib/link-url";
import { captureLink } from "@/lib/og";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";

/**
 * Share-sheet capture. Two callers: the Android PWA share target (session
 * cookie, gets a 303 into the app) and the iOS Shortcut (`CAPTURE_TOKEN`,
 * `Accept: application/json`, gets `{ card, existing }`). A link that is
 * already saved is returned instead of duplicated, unless images ride along.
 */
export async function POST(request: NextRequest) {
  if (!(await authorize(request, "capture"))) return unauthorized();

  const form = await request.formData();
  const title = (form.get("title") as string | null)?.trim() || null;
  const text = (form.get("text") as string | null)?.trim() || "";
  const url = (form.get("url") as string | null)?.trim() || null;
  const images = form.getAll("files").filter((e): e is File => e instanceof File && e.type.startsWith("image/"));

  // Instagram, Messages, and Signal put the link inside `text`, sometimes with
  // a caption around it; the link becomes the card's url and only the caption
  // stays as body.
  const inText = /https?:\/\/\S+/.exec(text);
  const sharedUrl = url ?? inText?.[0] ?? null;
  const note =
    inText && sharedUrl && canonicalUrl(inText[0]) === canonicalUrl(sharedUrl)
      ? [text.slice(0, inText.index).trim(), text.slice(inText.index + inText[0].length).trim()].filter(Boolean).join(" ")
      : text;

  const existing = sharedUrl && images.length === 0 ? await findCardByUrl(sharedUrl) : null;
  const card = existing ?? (await createSharedCard(title, note, sharedUrl, images));

  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json({ card, existing: existing !== null }, { status: existing ? 200 : 201 });
  }
  // Redirect the opened PWA window to the card (or inbox).
  const dest = card.type === "board" ? "/" : `/cards/${card.id}`;
  return NextResponse.redirect(new URL(dest, request.url), 303);
}

async function createSharedCard(
  title: string | null,
  note: string,
  sharedUrl: string | null,
  images: File[],
): Promise<CardView> {
  const embeds: string[] = [];
  for (const image of images) {
    const fileId = await ingestImageBytes(Buffer.from(await image.arrayBuffer()), image.type);
    if (fileId) embeds.push(`![${image.name}](file:${fileId})`);
  }
  const body = [note, embeds.join("\n")].filter(Boolean).join("\n\n") || null;

  const card = await createCard({
    type: sharedUrl ? "link" : "thought",
    title,
    body,
    url: sharedUrl,
    props: { source: { via: "share" } },
  });
  if (card.type === "link" && card.url) after(() => captureLink(card.id, card.url!));
  after(() => embedCard(card.id));
  return card;
}
