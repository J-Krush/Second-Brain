import { type NextRequest } from "next/server";
import { z } from "zod";
import { askStream } from "@/lib/ask";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";
import { type SearchFilters } from "@/lib/search";

export const runtime = "nodejs";

const askSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  type: z.string().optional(),
  tag: z.number().int().optional(),
});

/**
 * POST { question, type?, tag? } → `application/x-ndjson`, one AskEvent per
 * line. Retrieval completes before the response is committed (first event is
 * `sources`), so the request-scoped DB pool is never touched mid-stream.
 */
export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const parsed = askSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "invalid");

  const filters: SearchFilters = { type: parsed.data.type, tagId: parsed.data.tag };
  const events = askStream(parsed.data.question, filters, request.signal);
  const first = await events.next();
  if (first.done) return badRequest("no events");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(first.value) + "\n"));
      for await (const event of events) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }
      controller.close();
    },
    cancel() {
      void events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
