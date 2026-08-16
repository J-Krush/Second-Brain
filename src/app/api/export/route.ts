import { Readable } from "node:stream";
import { type NextRequest } from "next/server";
import { buildExportArchive } from "@/lib/export";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const archive = buildExportArchive();
  const stamp = new Date().toISOString().slice(0, 10);
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="second-brain-${stamp}.zip"`,
    },
  });
}
