import {
  ENGAGEMENT_BATCH_MAX,
  ENGAGEMENT_MAX_DURATION_MS,
  type EngagementEventInput,
} from "@capital-q/contracts";

/**
 * Q Workspace §8 A1: the one engagement controller in the browser.
 *
 * Components report what was on screen (a profile, a slide and how long, a
 * video and how far); this queues, batches and sends. It never says who is
 * looking: the API resolves the viewer from the session and the database
 * applies their privacy setting. Analytics may be lost; nothing here
 * retries, blocks a swipe or waits on the network.
 *
 * Batched like the Q receipt reporter: one request per BATCH_MS or per
 * ENGAGEMENT_BATCH_MAX events, and whatever is queued goes with keepalive
 * when the page is hidden or closed.
 */

export const ENGAGEMENT_ROUTE = "/api/engagement";
const BATCH_MS = 2_000;

/** What a component reports. Ids and timestamps are added here. */
type WithoutClientFields<T> = T extends unknown
  ? Omit<T, "clientEventId" | "sessionId" | "occurredAt">
  : never;
export type EngagementReport = WithoutClientFields<EngagementEventInput>;

export type EngagementTransport = (
  events: readonly EngagementEventInput[],
) => void;

export const fetchEngagementTransport: EngagementTransport = (events) => {
  void fetch(ENGAGEMENT_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
};

function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type EngagementReporter = {
  readonly report: (event: EngagementReport) => void;
  /** Starts timing; the returned function reports the dwell once. */
  readonly dwell: (
    event: (durationMs: number) => EngagementReport | null,
  ) => () => void;
  readonly flush: () => void;
};

export function createEngagementReporter(
  transport: EngagementTransport = fetchEngagementTransport,
  options: {
    readonly now?: () => number;
    readonly schedule?: (run: () => void, ms: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
  } = {},
): EngagementReporter {
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const cancel =
    options.cancel ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const sessionId = randomId("ses");
  let pending: EngagementEventInput[] = [];
  let timer: unknown = null;

  const flush = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    while (pending.length > 0) {
      transport(pending.slice(0, ENGAGEMENT_BATCH_MAX));
      pending = pending.slice(ENGAGEMENT_BATCH_MAX);
    }
  };

  const report = (event: EngagementReport) => {
    pending.push({
      ...event,
      clientEventId: randomId("eng"),
      sessionId,
      occurredAt: new Date(now()).toISOString(),
    });
    if (pending.length >= ENGAGEMENT_BATCH_MAX) flush();
    else timer ??= schedule(flush, BATCH_MS);
  };

  const dwell: EngagementReporter["dwell"] = (build) => {
    const started = now();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const ms = Math.min(
        ENGAGEMENT_MAX_DURATION_MS,
        Math.max(0, Math.round(now() - started)),
      );
      const event = build(ms);
      if (event !== null) report(event);
    };
  };

  return { report, dwell, flush };
}

let shared: EngagementReporter | null = null;

/** The page's single reporter, flushed when the page is hidden. */
export function engagementReporter(): EngagementReporter {
  if (shared !== null) return shared;
  const reporter = createEngagementReporter();
  shared = reporter;
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", reporter.flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") reporter.flush();
    });
  }
  return reporter;
}
