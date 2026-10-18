import { getAdminClaimEvidence } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * 2026-10-08: an operator opens a claim's registry document. The API
 * decides who is a platform admin holding claims.read, records the read,
 * and answers a two-minute signed URL; the bytes go storage → browser.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const { requestId } = await params;
  const session = await apiSession();
  if (session === null) return new Response("Not found", { status: 404 });
  const evidence = await getAdminClaimEvidence(session, requestId).catch(
    () => null,
  );
  if (evidence === null) return new Response("Not found", { status: 404 });
  return new Response(null, {
    status: 303,
    headers: { location: evidence.url, "cache-control": "no-store" },
  });
}
