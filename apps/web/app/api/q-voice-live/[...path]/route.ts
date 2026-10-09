import { relayLive } from "@/features/voice/live/live-relay-proxy";

/**
 * V: the GPT-Live line's relays: /api/q-voice-live/<relay>[/<voiceSessionId>
 * [/<delegationId>]]. Gated to the local developer preview; all logic and
 * validation live in the voice feature.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  if (path.length < 1 || path.length > 3) {
    return Response.json({ status: 404 }, { status: 404 });
  }
  return relayLive(request, {
    relay: path[0] ?? "",
    voiceSessionId: path[1],
    delegationId: path[2],
  });
}
