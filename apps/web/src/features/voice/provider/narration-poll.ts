import type { QVoiceDuplexNarrationResult } from "@capital-q/contracts";

import { loadWire } from "../../q/wire";

/**
 * ADR 0062: one long poll for the silence ladder's beats on a duplex line.
 * A route, not a server action (actions run one at a time per client, and
 * this runs beside the ask_q relay). Anything but a valid answer is null:
 * the line then simply stays quiet.
 */
export async function pollNarration(
  voiceSessionId: string,
  after: number,
  doFetch: typeof fetch = fetch,
): Promise<QVoiceDuplexNarrationResult | null> {
  try {
    const response = await doFetch(
      `/api/q-voice-narration/${encodeURIComponent(voiceSessionId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ after }),
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    // W7: the wire's contracts, loaded off the first paint.
    const [body, { QVoiceDuplexNarrationResultSchema }] = await Promise.all([
      response.json(),
      loadWire(),
    ]);
    const parsed = QVoiceDuplexNarrationResultSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
