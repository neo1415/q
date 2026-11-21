import { NextResponse } from "next/server";

import { cspViolationKinds } from "@/security/csp";

/**
 * W1-A: where browsers report what the report-only CSP would have blocked
 * (src/security/csp.ts). Public by nature (a browser sends it with no
 * session), so it accepts a bounded body, logs each violation as kinds
 * only, and always answers 204: nothing it says reveals anything.
 */
export const dynamic = "force-dynamic";

/** A report is small; anything larger is not read. */
const CSP_REPORT_MAX_BYTES = 16_384;

const done = () =>
  new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > CSP_REPORT_MAX_BYTES) return done();
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > CSP_REPORT_MAX_BYTES) return done();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }
  const kinds = cspViolationKinds(body, originOf(request.url));
  if (kinds.length > 0) {
    // Kinds only: never a URL, a sample or the page it happened on.
    console.warn(
      JSON.stringify({ msg: "csp report-only violation", violations: kinds }),
    );
  }
  return done();
}
