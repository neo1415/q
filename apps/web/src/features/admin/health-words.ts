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
