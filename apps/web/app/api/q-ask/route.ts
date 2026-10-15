import { NextResponse } from "next/server";

import { askQAction, type QSubjectInput } from "@/features/q/actions";

/**
 * V (K1 browser budget, 2026-10-09): a typed question to Q, as a route.
 * Server actions run one at a time per tab, and on /home the arrival's
 * own actions (briefing, voice session, slate, notices) were in that
 * queue: the question waited 1.6 s behind them before it was even sent
 * (traced: Enter 30.234, askQAction 31.850). A route is not queued.
 *
 * Same work and the same checks as askQAction, which this calls: every
 * input is parsed there, the Q API authorises as the signed-in person.
 * Only JSON from this site's own pages is accepted (a cross-site form
 * cannot send it, and the Origin must be ours).
 */
export const dynamic = "force-dynamic";

const refused = (status: number) =>
  NextResponse.json(
    { ok: false, message: "Q couldn't take that question. Try again." },
    { status, headers: { "cache-control": "no-store" } },
  );

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  // The host the browser addressed (behind a proxy, the forwarded one):
  // request.url can name the server's own bind address instead.
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host === null) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The subject as askQAction takes it (it validates the ids itself). */
function subjectOf(raw: unknown): QSubjectInput | string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object" || raw === null) return undefined;
  const companyId: unknown = Reflect.get(raw, "companyId");
  if (typeof companyId === "string") return { companyId };
  const investorOrganisationId: unknown = Reflect.get(
    raw,
    "investorOrganisationId",
  );
  if (typeof investorOrganisationId === "string") {
    return { investorOrganisationId };
  }
  const relationshipId: unknown = Reflect.get(raw, "relationshipId");
  if (typeof relationshipId === "string") return { relationshipId };
  return undefined;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) return refused(403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json"))
    return refused(415);
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return refused(400);
  const field = (name: string): unknown => Reflect.get(body, name);
  const text = (name: string): string | undefined => {
    const value = field(name);
    return typeof value === "string" ? value : undefined;
  };
  const result = await askQAction(
    text("question") ?? "",
    text("conversationId"),
    subjectOf(field("subject")),
    text("idempotencyKey"),
    field("viewing"),
    field("screen"),
    text("opening"),
  );
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
