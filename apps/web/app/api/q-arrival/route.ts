import { NextResponse } from "next/server";
import { z } from "zod";

import { readArrivalBriefing } from "@/features/briefing/arrival-briefing-server";

/**
 * The arrival briefing's read for the browser (speed lane 2026-10-20). A
 * route, not a server action: server actions run one at a time per tab
 * (audit C-08), so the briefing waited behind Home's other actions on
 * every arrival and held them in turn. The person's own session from the
 * request's cookies; the body is validated again by the read.
 */
export const dynamic = "force-dynamic";

const Body = z.object({
  since: z.unknown().optional(),
  browser: z.unknown().optional(),
});

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const raw: unknown = await request.json().catch(() => null);
  const body = Body.safeParse(raw);
  if (!body.success) {
    return NextResponse.json(null, { status: 400, headers: NO_STORE });
  }
  // Both parts are validated strictly by the read itself.
  const data = await readArrivalBriefing(
    body.data.since ?? null,
    body.data.browser,
  ).catch(() => null);
  return NextResponse.json(data, { headers: NO_STORE });
}
