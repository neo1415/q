import { downloadGateqPack } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F4: the download pack, as the signed-in investor's own request. The API
 * builds it under GateQ's gateway authority from only what the founder
 * sent, and records who downloaded it; this hands the zip to their device.
 * Never cached, never shared between people.
 */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly gatewayId: string;
      readonly applicationId: string;
    }>;
  },
): Promise<Response> {
  const { gatewayId, applicationId } = await params;
  const session = await apiSession();
  if (session === null || !UUID.test(gatewayId) || !UUID.test(applicationId)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const pack = await downloadGateqPack(session, gatewayId, applicationId);
    return new Response(pack.bytes, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${pack.fileName.replace(/[^\w.-]/g, "-")}"`,
        "cache-control": "no-store, private",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
