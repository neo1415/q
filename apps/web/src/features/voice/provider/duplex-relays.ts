import type {
  QVoiceCardUpdate,
  QVoiceDuplexHeardResult,
  QVoiceDuplexRejoinResult,
  QVoiceDuplexToolResult,
  QVoiceDuplexUsageResult,
} from "@capital-q/contracts";

import type { DuplexRelays } from "./duplex-line";

/**
 * RECOVERY A8 (C-08): the duplex line's relays over fetch, each with a
 * deadline. Server actions ran one at a time per tab, so a long `heard`
 * held every other relay and the turn poll; and a relay with no deadline
 * held "Thinking" forever. Replies are validated by the route; anything
 * but a good answer is null, which the line already treats as "did not
 * get through". A 404 also tells the line it is gone on the server (A11).
 */

/** Past the server's ask_q deadline (30 s), so its own words arrive first. */
export const ASK_RELAY_DEADLINE_MS = 38_000;
export const SHORT_RELAY_DEADLINE_MS = 10_000;

/**
 * E-03: one card update for a standard line (focus, or the verdict on a
 * spoken reply), through the same route. Best effort: a lost update only
 * means the turn goes to Q as any other.
 */
export async function postCardUpdate(
  voiceSessionId: string,
  sessionToken: string | undefined,
  update: QVoiceCardUpdate,
  doFetch: typeof fetch = (url, init) => fetch(url, init),
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SHORT_RELAY_DEADLINE_MS);
  try {
    await doFetch(
      `/api/q-voice-duplex/${encodeURIComponent(voiceSessionId)}/card`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(sessionToken === undefined
            ? {}
            : { "x-q-voice-session": sessionToken }),
        },
        body: JSON.stringify(boundedCardUpdate(update)),
        cache: "no-store",
        signal: controller.signal,
      },
    );
  } catch {
    // The turn goes to Q as any other.
  } finally {
    clearTimeout(timer);
  }
}

/** The contract bounds an outcome at 6,000 characters; keep what matters. */
function boundedCardUpdate(update: QVoiceCardUpdate): QVoiceCardUpdate {
  if (update.kind !== "VERDICT" || update.outcome === undefined) return update;
  if (JSON.stringify(update.outcome).length <= 6_000) return update;
  const { ok, done, situation, editedMessageOnScreen, nextCard } =
    update.outcome;
  const slim: Record<string, unknown> = { ok, done, situation, nextCard };
  if (typeof editedMessageOnScreen === "string") {
    slim.editedMessageOnScreen = editedMessageOnScreen.slice(0, 1_500);
  }
  return JSON.stringify(slim).length <= 6_000
    ? { ...update, outcome: slim }
    : { ...update, outcome: { ok, done } };
}

export function fetchDuplexRelays(input: {
  readonly voiceSessionId: string;
  /** The sealed line (A11): any Q API instance can adopt it. */
  readonly sessionToken?: string | undefined;
  /** The server no longer knows this line (404, after adoption failed). */
  readonly onGone?: (() => void) | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly narration?: DuplexRelays["narration"];
}): DuplexRelays {
  const doFetch = input.fetch ?? ((url, init) => fetch(url, init));
  const base = `/api/q-voice-duplex/${encodeURIComponent(input.voiceSessionId)}`;
  const post = async (
    relay: string,
    body: unknown,
    deadlineMs: number,
  ): Promise<Response | null> => {
    // Null: it did not get through at all (network, deadline).
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, deadlineMs);
    try {
      const response = await doFetch(`${base}/${relay}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.sessionToken === undefined
            ? {}
            : { "x-q-voice-session": input.sessionToken }),
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) input.onGone?.();
      return response;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const json = async <T>(response: Response | null): Promise<T | null> => {
    if (response === null || !response.ok) return null;
    try {
      // Validated by the route against the contract before it got here.
      return (await response.json()) as T;
    } catch {
      return null;
    }
  };
  return {
    tool: async (call) =>
      json<QVoiceDuplexToolResult>(
        await post("tool", call, ASK_RELAY_DEADLINE_MS),
      ),
    heard: async (heard) =>
      json<QVoiceDuplexHeardResult>(
        await post("heard", heard, ASK_RELAY_DEADLINE_MS),
      ),
    usage: async (report) =>
      json<QVoiceDuplexUsageResult>(
        await post("usage", report, SHORT_RELAY_DEADLINE_MS),
      ),
    rejoin: async (cause) => {
      const response = await post("rejoin", { cause }, SHORT_RELAY_DEADLINE_MS);
      // A rejoin that did not get through is tried again by the line; one
      // the server refused (404) is null.
      if (response === null || (!response.ok && response.status !== 404)) {
        throw new Error("rejoin did not get through");
      }
      return json<QVoiceDuplexRejoinResult>(response);
    },
    end: async (reason, detail) => {
      await post("end", { ...detail, reason }, SHORT_RELAY_DEADLINE_MS);
    },
    said: async (said) => {
      await post("said", said, SHORT_RELAY_DEADLINE_MS);
    },
    outcome: async (outcome) => {
      await post("outcome", outcome, SHORT_RELAY_DEADLINE_MS);
    },
    attach: async (callId) => {
      await post("attach", { callId }, SHORT_RELAY_DEADLINE_MS);
    },
    ...(input.narration === undefined ? {} : { narration: input.narration }),
  };
}
