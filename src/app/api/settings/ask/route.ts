import { NextResponse, type NextRequest } from "next/server";
import { askSettingsPatchSchema } from "@/lib/ask-config";
import { authorize, badRequest, unauthorized } from "@/lib/route-helpers";
import { getAskSettings, updateAskSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  return NextResponse.json({ settings: await getAskSettings() });
}

/** PUT a partial document; unknown keys are dropped, out-of-range values are 400. */
export async function PUT(request: NextRequest) {
  if (!(await authorize(request))) return unauthorized();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const parsed = askSettingsPatchSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return badRequest(`${issue?.path.join(".") ?? "settings"}: ${issue?.message ?? "invalid"}`);
  }
  return NextResponse.json({ settings: await updateAskSettings(parsed.data) });
}
