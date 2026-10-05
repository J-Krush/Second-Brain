import { type NextRequest } from "next/server";
import { buildExportArchive } from "@/lib/export";
import { authorize, unauthorized } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buildExportArchive(), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="second-brain-${stamp}.zip"`,
    },
  });
}
