import {
  isDurableQStreamEvent,
  isTerminalQStreamEvent,
  LAST_EVENT_ID_HEADER,
  Q_RUN_EVENTS_SUFFIX,
  Q_RUNS_PATH,
  Q_SSE_CONTENT_TYPE,
  QStreamEventSchema,
  type QStreamEvent,
} from "@capital-q/contracts";

import {
  ApiProblemError,
  readProblemResponse,
  UNEXPECTED_API_RESPONSE,
} from "./problem.js";
import type { ApiSession } from "./request.js";
import { createSseParser } from "./sse.js";

/**
 * The Q run stream client (CQ-Q-009 §73-§80).
 *
 * A fetch-based SSE reader, because Capital Q authenticates with a bearer
 * token and the native EventSource cannot send one; a token in the URL is
 * prohibited (§74). It sends the normal Authorization header, parses SSE
 * properly, follows the server's `retry:` hint within bounded backoff, and
 * reconnects with `Last-Event-ID` set to the last DURABLE sequence it
 * processed — deltas never move that cursor (§77). Replayed durable events
 * with a sequence the client already saw are dropped (§24, §80).
 *
 * The transport state is the client's own (§123): CONNECTING, CONNECTED,
 * RECONNECTING, CLOSED. It is never the run's status; a dropped socket is
 * not a failed run (§122).
 */

export type QStreamTransportStatus =
  "CONNECTING" | "CONNECTED" | "RECONNECTING" | "CLOSED";

export type QStreamEventMeta = {
  /** True for events that carry a resume id; false for deltas. */
  readonly durable: boolean;
  /** True when this connection is a reconnect and the event was replayed. */
  readonly replayed: boolean;
};

export type QStreamCloseReason =
  | "TERMINAL"
  | "ABORTED"
  | "SERVER_CLOSED"
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "GAVE_UP";

export type QRunStreamOptions = {
  readonly signal?: AbortSignal | undefined;
  /** Resume from this durable sequence; 0 or absent replays from the start. */
  readonly lastEventId?: number | undefined;
  readonly onEvent: (event: QStreamEvent, meta: QStreamEventMeta) => void;
  readonly onStatus?:
    ((status: QStreamTransportStatus, attempt: number) => void) | undefined;
  /** Bounded exponential backoff with jitter (§76). */
  readonly backoff?:
    | {
        readonly initialMs?: number | undefined;
        readonly maxMs?: number | undefined;
        readonly maxAttempts?: number | undefined;
        readonly jitter?: (() => number) | undefined;
      }
    | undefined;
};

export type QRunStreamResult = {
  readonly reason: QStreamCloseReason;
  /** The last durable sequence processed; the cursor to resume from. */
  readonly lastEventId: number;
  readonly reconnects: number;
};

const DEFAULT_BACKOFF = {
  initialMs: 500,
  maxMs: 15_000,
  maxAttempts: 20,
};

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function eventsPath(runId: string): string {
  return `${Q_RUNS_PATH}/${encodeURIComponent(runId)}${Q_RUN_EVENTS_SUFFIX}`;
}

/**
 * Streams a run's events until a terminal event, an abort, an
 * authentication or not-found refusal, or the reconnect budget is spent.
 * Resolves with the reason and the cursor; never throws for a dropped
 * connection.
 */
export async function streamQRunEvents(
  session: ApiSession,
  runId: string,
  options: QRunStreamOptions,
): Promise<QRunStreamResult> {
  const doFetch = session.fetch ?? fetch;
  const backoff = {
    initialMs: options.backoff?.initialMs ?? DEFAULT_BACKOFF.initialMs,
    maxMs: options.backoff?.maxMs ?? DEFAULT_BACKOFF.maxMs,
    maxAttempts: options.backoff?.maxAttempts ?? DEFAULT_BACKOFF.maxAttempts,
  };
  const jitter = options.backoff?.jitter ?? Math.random;
  let lastEventId = options.lastEventId ?? 0;
  let attempt = 0;
  let reconnects = 0;
  let serverRetryMs: number | undefined;
  const outerSignal = options.signal;

  const report = (status: QStreamTransportStatus) =>
    options.onStatus?.(status, attempt);

  for (;;) {
    if (outerSignal?.aborted) {
      report("CLOSED");
      return { reason: "ABORTED", lastEventId, reconnects };
    }
    report(attempt === 0 ? "CONNECTING" : "RECONNECTING");
    const isReconnect = attempt > 0 || (options.lastEventId ?? 0) > 0;

    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: Q_SSE_CONTENT_TYPE,
        authorization: `Bearer ${session.accessToken}`,
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
        ...(lastEventId > 0
          ? { [LAST_EVENT_ID_HEADER]: String(lastEventId) }
          : {}),
      };
      response = await doFetch(
        `${session.baseUrl.replace(/\/$/, "")}${eventsPath(runId)}`,
        {
          method: "GET",
          headers,
          cache: "no-store",
          ...(outerSignal === undefined ? {} : { signal: outerSignal }),
        },
      );
    } catch {
      if (outerSignal?.aborted) {
        report("CLOSED");
        return { reason: "ABORTED", lastEventId, reconnects };
      }
      // A connection failure: back off and try again.
      attempt += 1;
      if (attempt > backoff.maxAttempts) {
        report("CLOSED");
        return { reason: "GAVE_UP", lastEventId, reconnects };
      }
      await delay(nextDelay(attempt), outerSignal);
      continue;
    }

    if (!response.ok) {
      const problem = await readProblemResponse(response);
      if (response.status === 401 || response.status === 403) {
        report("CLOSED");
        throw problem;
      }
      if (response.status === 404 || response.status === 422) {
        report("CLOSED");
        throw problem;
      }
      // 429 and 5xx: bounded retry.
      attempt += 1;
      if (attempt > backoff.maxAttempts) {
        report("CLOSED");
        throw problem;
      }
      await delay(nextDelay(attempt), outerSignal);
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith(Q_SSE_CONTENT_TYPE) || response.body === null) {
      throw new ApiProblemError(
        "The API did not return a Q event stream.",
        response.status,
        UNEXPECTED_API_RESPONSE,
        response.headers.get("x-request-id") ?? undefined,
      );
    }

    report("CONNECTED");
    if (attempt > 0) {
      reconnects += 1;
    }
    attempt = 0;

    const parser = createSseParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let terminal = false;
    // Everything at or below this sequence was replayed to a reconnecting
    // client, not produced while it was connected.
    const replayBoundary = lastEventId;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        for (const message of parser.feed(chunk)) {
          let raw: unknown;
          try {
            raw = JSON.parse(message.data);
          } catch {
            continue;
          }
          const parsed = QStreamEventSchema.safeParse(raw);
          if (!parsed.success) {
            continue;
          }
          const event = parsed.data;
          if (event.runId !== runId) {
            continue;
          }
          const durable = isDurableQStreamEvent(event);
          if (durable) {
            if (event.sequence <= lastEventId) {
              continue; // already processed: a replay overlap
            }
            const replayed = isReconnect && event.sequence <= replayBoundary;
            lastEventId = event.sequence;
            options.onEvent(event, { durable: true, replayed });
            if (isTerminalQStreamEvent(event)) {
              terminal = true;
              break;
            }
          } else {
            options.onEvent(event, { durable: false, replayed: false });
          }
        }
        if (terminal) {
          break;
        }
      }
    } catch {
      // The socket dropped mid-stream; fall through to reconnect.
    } finally {
      serverRetryMs = parser.retryMs();
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
    }

    if (terminal) {
      report("CLOSED");
      return { reason: "TERMINAL", lastEventId, reconnects };
    }
    if (outerSignal?.aborted) {
      report("CLOSED");
      return { reason: "ABORTED", lastEventId, reconnects };
    }
    // The server closed without a terminal event (deploy, proxy, error):
    // reconnect from the cursor. Replayed events beyond it are new to us.
    attempt += 1;
    if (attempt > backoff.maxAttempts) {
      report("CLOSED");
      return { reason: "GAVE_UP", lastEventId, reconnects };
    }
    await delay(nextDelay(attempt), outerSignal);
  }

  function nextDelay(n: number): number {
    const base = Math.min(
      backoff.maxMs,
      (serverRetryMs ?? backoff.initialMs) * 2 ** (n - 1),
    );
    // Full jitter: somewhere between half the base and the base.
    return Math.round(base / 2 + (base / 2) * jitter());
  }
}

/** Plain English for a transport state (§121-§123); never a run status. */
export function describeQStreamTransport(
  status: QStreamTransportStatus,
): string {
  switch (status) {
    case "CONNECTING":
      return "Connecting to Q…";
    case "CONNECTED":
      return "Connected to Q.";
    case "RECONNECTING":
      return "I lost the connection to Q. Reconnecting…";
    case "CLOSED":
      return "Disconnected from Q.";
  }
}

export type { QStreamEvent };
