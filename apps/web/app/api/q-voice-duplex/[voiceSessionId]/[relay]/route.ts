import { relayDuplex } from "@/features/voice/duplex-relay-proxy";

/**
 * RECOVERY A8: the duplex voice line's relays, as a route rather than
 * server actions (which Next.js runs one at a time per client). All logic
 * and validation live in the voice feature.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ voiceSessionId: string; relay: string }> },
): Promise<Response> {
  return relayDuplex(request, await context.params);
}
