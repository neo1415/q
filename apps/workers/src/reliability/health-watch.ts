import type { OpsFinding } from "./ops-check.js";

/**
 * W1-B (enterprise audit 21 Nov 2026, finding 5): uptime and error-rate
 * alerting with what already runs. On every operational check the workers
 * ask each configured service's readiness (`/health/ready`), and read the
 * request counts the answer carries (W1-B traffic: requests and server
 * errors over 15 minutes). Two findings, each through the operator channel
 * (`createOperatorAlerts`: de-duplicated per key, then quiet for its
 * cooldown):
 *
 * - SERVICE_UNHEALTHY: a service did not answer ready this many checks in
 *   a row (one slow answer is not an outage);
 * - ERROR_RATE_SPIKE: a service's share of 5xx answers over its window,
 *   once enough requests exist to make a rate mean something.
 *
 * Targets come from CQ_HEALTH_PROBE_TARGETS ("api=https://…,q-api=https://…");
 * unset, nothing is probed and one line says so. No paid service, no new
 * provider, no credential: the readiness answer is public by design.
 */
export type HealthTarget = { readonly service: string; readonly url: string };

export type HealthWatchThresholds = {
  readonly failuresInARow: number;
  readonly errorRate: number;
  readonly errorMinRequests: number;
  readonly probeTimeoutMs: number;
};

export const DEFAULT_HEALTH_WATCH: HealthWatchThresholds = {
  failuresInARow: 3,
  errorRate: 0.05,
  errorMinRequests: 50,
  probeTimeoutMs: 5_000,
};

export function parseHealthTargets(
  env: Readonly<Record<string, string | undefined>>,
): {
  readonly targets: readonly HealthTarget[];
  readonly invalid: readonly string[];
} {
  const raw = env["CQ_HEALTH_PROBE_TARGETS"]?.trim() ?? "";
  const targets: HealthTarget[] = [];
  const invalid: string[] = [];
  for (const entry of raw.split(",").map((part) => part.trim())) {
    if (entry.length === 0) continue;
    const at = entry.indexOf("=");
    // No "=": the whole entry is named as invalid, never a cut of it.
    const service = at < 0 ? entry : entry.slice(0, at).trim();
    const url = entry.slice(at + 1).trim();
    let parsed: URL | null = null;
    try {
      parsed = at > 0 ? new URL(url) : null;
    } catch {
      parsed = null;
    }
    if (
      parsed === null ||
      !/^[a-z][a-z0-9-]{0,30}$/u.test(service) ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    ) {
      invalid.push(service.length > 0 ? service : entry.slice(0, 20));
      continue;
    }
    targets.push({ service, url: new URL("/health/ready", parsed).toString() });
  }
  return { targets, invalid };
}

export type ProbeResult = {
  readonly service: string;
  readonly ready: boolean;
  readonly traffic: {
    readonly windowMinutes: number;
    readonly requests: number;
    readonly serverErrors: number;
  } | null;
};

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

function trafficOf(body: unknown): ProbeResult["traffic"] {
  if (typeof body !== "object" || body === null || !("traffic" in body)) {
    return null;
  }
  const traffic = body.traffic;
  if (typeof traffic !== "object" || traffic === null) return null;
  const windowMinutes = whole(
    "windowMinutes" in traffic ? traffic.windowMinutes : null,
  );
  const requests = whole("requests" in traffic ? traffic.requests : null);
  const serverErrors = whole(
    "serverErrors" in traffic ? traffic.serverErrors : null,
  );
  return windowMinutes === null || requests === null || serverErrors === null
    ? null
    : { windowMinutes, requests, serverErrors };
}

export type HealthFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;

/** Each target's readiness; a throw, a timeout or a non-2xx is not ready. */
export async function probeHealth(
  targets: readonly HealthTarget[],
  fetcher: HealthFetch,
  timeoutMs: number,
): Promise<readonly ProbeResult[]> {
  return Promise.all(
    targets.map(async (target): Promise<ProbeResult> => {
      try {
        const response = await fetcher(target.url, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.json().catch(() => null);
        return {
          service: target.service,
          ready: response.ok,
          traffic: trafficOf(body),
        };
      } catch {
        return { service: target.service, ready: false, traffic: null };
      }
    }),
  );
}

export type ServiceHealthSummary = {
  readonly service: string;
  readonly ready: boolean;
  readonly failuresInARow: number;
  readonly requests: number | null;
  readonly serverErrors: number | null;
  readonly windowMinutes: number | null;
};

const pct = (value: number): string => `${String(Math.round(value * 100))}%`;

/**
 * The watch's memory between checks: failures in a row per service. Pure
 * apart from that state; the findings say what is wrong in plain words.
 */
export function createHealthWatch(
  thresholds: HealthWatchThresholds = DEFAULT_HEALTH_WATCH,
): {
  readonly assess: (results: readonly ProbeResult[]) => readonly OpsFinding[];
  readonly summary: () => readonly ServiceHealthSummary[];
} {
  const failures = new Map<string, number>();
  let last: readonly ProbeResult[] = [];
  return {
    assess: (results) => {
      last = results;
      const findings: OpsFinding[] = [];
      for (const result of results) {
        const inARow = result.ready
          ? 0
          : (failures.get(result.service) ?? 0) + 1;
        failures.set(result.service, inARow);
        if (inARow >= thresholds.failuresInARow) {
          findings.push({
            code: "SERVICE_UNHEALTHY",
            key: `ops:service-unhealthy:${result.service}`,
            subject: `${result.service} is not answering`,
            text: `${result.service} has not answered its health check ${String(inARow)} times in a row. People may not be able to use it; check its deployment and logs.`,
            fields: { service: result.service, failuresInARow: inARow },
          });
        }
        const traffic = result.traffic;
        if (
          traffic !== null &&
          traffic.requests >= thresholds.errorMinRequests &&
          traffic.serverErrors / traffic.requests >= thresholds.errorRate
        ) {
          const rate = traffic.serverErrors / traffic.requests;
          findings.push({
            code: "ERROR_RATE_SPIKE",
            key: `ops:error-rate:${result.service}`,
            subject: `${result.service} is returning errors`,
            text: `${result.service} answered ${String(traffic.serverErrors)} of ${String(traffic.requests)} requests in the last ${String(traffic.windowMinutes)} minutes with a server error (${pct(rate)}).`,
            fields: {
              service: result.service,
              requests: traffic.requests,
              serverErrors: traffic.serverErrors,
              errorRate: rate,
            },
          });
        }
      }
      return findings;
    },
    summary: () =>
      last.map((result) => ({
        service: result.service,
        ready: result.ready,
        failuresInARow: failures.get(result.service) ?? 0,
        requests: result.traffic?.requests ?? null,
        serverErrors: result.traffic?.serverErrors ?? null,
        windowMinutes: result.traffic?.windowMinutes ?? null,
      })),
  };
}
