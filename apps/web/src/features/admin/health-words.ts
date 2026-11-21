import type { ServicePoolDto } from "@capital-q/contracts";

/**
 * How the console's System health words a service's pool and a worker's
 * heartbeat (19 Nov 2026 pool wedge). A reading the server did not give is
 * "Not reported", never green; a heartbeat older than two minutes is down;
 * a pool recycled in the last day is a warning, said in words.
 */

export type HealthTone = "OK" | "WARNING" | "DOWN" | "UNKNOWN";

export type HealthLine = {
  readonly tone: HealthTone;
  readonly text: string;
};

export const HEARTBEAT_STALE_MS = 2 * 60_000;
const RECYCLE_WARNING_MS = 24 * 3_600_000;

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** "0.4 s", "12 s", "3 min". */
export function seconds(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 120_000) return `${String(Math.round(ms / 1000))} s`;
  return `${String(Math.round(ms / 60_000))} min`;
}

export const NOT_REPORTED: HealthLine = {
  tone: "UNKNOWN",
  text: "Not reported",
};

/** "3 of 10 in use · oldest 0.4 s"; a recycle in the last day warns. */
export function poolLine(
  pool: ServicePoolDto | null | undefined,
  now: number,
): HealthLine {
  if (pool === null || pool === undefined) return NOT_REPORTED;
  const parts = [`${String(pool.held)} of ${String(pool.slots)} in use`];
  if (pool.oldestHeldMs !== null)
    parts.push(`oldest ${seconds(pool.oldestHeldMs)}`);
  if (pool.waiting > 0) parts.push(`${String(pool.waiting)} waiting`);
  const recycledAt =
    pool.lastRecycledAt === null ? null : Date.parse(pool.lastRecycledAt);
  const recent =
    recycledAt !== null &&
    !Number.isNaN(recycledAt) &&
    now - recycledAt <= RECYCLE_WARNING_MS;
  if (recent) {
    parts.push(`recycled at ${TIME.format(new Date(recycledAt))} UTC`);
  }
  const full = pool.slots > 0 && pool.held >= pool.slots && pool.waiting > 0;
  return {
    tone: recent || full ? "WARNING" : "OK",
    text: parts.join(" · "),
  };
}

/** "heartbeat 12 s ago"; older than two minutes is down. */
export function heartbeatLine(
  lastBeatAt: string | null | undefined,
  now: number,
): HealthLine {
  if (lastBeatAt === null || lastBeatAt === undefined) return NOT_REPORTED;
  const at = Date.parse(lastBeatAt);
  if (Number.isNaN(at)) return NOT_REPORTED;
  const age = Math.max(0, now - at);
  return age > HEARTBEAT_STALE_MS
    ? { tone: "DOWN", text: `Down: last heartbeat ${seconds(age)} ago` }
    : { tone: "OK", text: `heartbeat ${seconds(age)} ago` };
}

/**
 * A pool that is not gated (direct or session mode) exposes only its size:
 * its use is not measured, so it is "Not reported", with the size said.
 */
export function ungatedPoolLine(maxConnections: number): HealthLine {
  return {
    tone: "UNKNOWN",
    text: `Not reported: not gated, up to ${String(maxConnections)} connections`,
  };
}

/** The workers' last operational check: its finding codes, in words. */
export function checkLine(
  check:
    | {
        readonly checkedAt: string | null;
        readonly findings: readonly string[];
      }
    | null
    | undefined,
): HealthLine {
  if (check === null || check === undefined || check.checkedAt === null) {
    return NOT_REPORTED;
  }
  if (check.findings.includes("CHECK_FAILED")) {
    return { tone: "DOWN", text: "Could not read the database" };
  }
  return check.findings.length === 0
    ? { tone: "OK", text: "No findings" }
    : {
        tone: "WARNING",
        text: check.findings
          .map((code) => code.toLowerCase().replaceAll("_", " "))
          .join(", "),
      };
}

/**
 * W1-B: a service's server errors over its window, in words: "0.4% of
 * 1,240 requests in 15 min"; 5% or more warns. No requests yet is said
 * as it is; a service that gave no counts is "Not reported".
 */
export const ERROR_RATE_WARNING = 0.05;

export function errorRateLine(
  traffic:
    | {
        readonly windowMinutes: number;
        readonly requests: number;
        readonly serverErrors: number;
      }
    | null
    | undefined,
): HealthLine {
  if (traffic === null || traffic === undefined) return NOT_REPORTED;
  if (traffic.requests === 0) {
    return {
      tone: "OK",
      text: `No requests in ${String(traffic.windowMinutes)} min`,
    };
  }
  const rate = traffic.serverErrors / traffic.requests;
  const shown =
    rate === 0 ? "0" : rate < 0.001 ? "<0.1" : (rate * 100).toFixed(1);
  return {
    tone: rate >= ERROR_RATE_WARNING ? "WARNING" : "OK",
    text: `${shown}% errors of ${traffic.requests.toLocaleString("en-GB")} requests in ${String(traffic.windowMinutes)} min`,
  };
}

/** W1-B: the workers' last alert: what and when, or none since they started. */
export function lastAlertLine(
  alert: { readonly subject: string; readonly at: string } | null | undefined,
  now: number,
): HealthLine {
  if (alert === null || alert === undefined) {
    return { tone: "OK", text: "None since the workers started" };
  }
  const at = Date.parse(alert.at);
  const ago = Number.isNaN(at)
    ? ""
    : ` · ${seconds(Math.max(0, now - at))} ago`;
  const recent = !Number.isNaN(at) && now - at <= 24 * 3_600_000;
  return {
    tone: recent ? "WARNING" : "OK",
    text: `${alert.subject}${ago}`,
  };
}
