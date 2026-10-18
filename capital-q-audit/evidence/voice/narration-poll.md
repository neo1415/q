# Evidence: apps/web/src/features/voice/provider/narration-poll.ts (lines 1-37)

- Original path: `apps/web/src/features/voice/provider/narration-poll.ts`
- Line range: 1-37 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Code comment acknowledging server actions run one at a time per client.

```ts
    1  import type { QVoiceDuplexNarrationResult } from "@capital-q/contracts";
    2
    3  import { loadWire } from "../../q/wire";
    4
    5  /**
    6   * ADR 0062: one long poll for the silence ladder's beats on a duplex line.
    7   * A route, not a server action (actions run one at a time per client, and
    8   * this runs beside the ask_q relay). Anything but a valid answer is null:
    9   * the line then simply stays quiet.
   10   */
   11  export async function pollNarration(
   12    voiceSessionId: string,
   13    after: number,
   14    doFetch: typeof fetch = fetch,
   15  ): Promise<QVoiceDuplexNarrationResult | null> {
   16    try {
   17      const response = await doFetch(
   18        `/api/q-voice-narration/${encodeURIComponent(voiceSessionId)}`,
   19        {
   20          method: "POST",
   21          headers: { "content-type": "application/json" },
   22          body: JSON.stringify({ after }),
   23          cache: "no-store",
   24        },
   25      );
   26      if (!response.ok) return null;
   27      // W7: the wire's contracts, loaded off the first paint.
   28      const [body, { QVoiceDuplexNarrationResultSchema }] = await Promise.all([
   29        response.json() as Promise<unknown>,
   30        loadWire(),
   31      ]);
   32      const parsed = QVoiceDuplexNarrationResultSchema.safeParse(body);
   33      return parsed.success ? parsed.data : null;
   34    } catch {
   35      return null;
   36    }
   37  }
```
