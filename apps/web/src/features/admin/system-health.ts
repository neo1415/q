import "server-only";

import { getQApiOpsPool } from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import type { ServicePoolDto } from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * What the console can measure about the running services, server-side
 * (admin design 2026-11-19 §4 T1): each service's own readiness answer
 * (its database check included), how long it took, and the deployed commit
 * where the host states it. Nothing is inferred: a service that does not
 * answer is "not answering", and a version the host doesn't give is left
 * out. Workers and the q-api pool watchdog expose no reading, so they are
 * not shown.
 */

export type ServiceHealth = {
  readonly service: "API" | "Q API";
  readonly state: "READY" | "NOT_READY" | "NOT_ANSWERING" | "NOT_CONFIGURED";
  /** The database check the service reported, as it said it. */
  readonly database: string | null;
  readonly millis: number | null;
  /**
   * W1-B: the service's own counts over its window, from its readiness
   * answer; null when it gave none.
   */
  readonly traffic?: ServiceTraffic | null | undefined;
};

export type ServiceTraffic = {
  readonly windowMinutes: number;
  readonly requests: number;
  readonly serverErrors: number;
};

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;

/** The counts a readiness answer carries, read like any input. */
export function trafficOf(body: unknown): ServiceTraffic | null {
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

const READY_TIMEOUT_MS = 3_000;

async function readiness(
  service: ServiceHealth["service"],
  baseUrl: string | undefined,
): Promise<ServiceHealth> {
  if (baseUrl === undefined) {
    return { service, state: "NOT_CONFIGURED", database: null, millis: null };
  }
  const started = performance.now();
  try {
    const response = await fetch(new URL("/health/ready", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    });
    const millis = Math.round(performance.now() - started);
    const body: unknown = await response.json().catch(() => null);
    const database =
      typeof body === "object" &&
      body !== null &&
      "checks" in body &&
      typeof body.checks === "object" &&
      body.checks !== null &&
      "database" in body.checks &&
      typeof body.checks.database === "string"
        ? body.checks.database
        : null;
    return {
      service,
      state: response.ok ? "READY" : "NOT_READY",
      database,
      millis,
      traffic: trafficOf(body),
    };
  } catch {
    return { service, state: "NOT_ANSWERING", database: null, millis: null };
  }
}

export async function systemHealth(): Promise<readonly ServiceHealth[]> {
  const { apiBaseUrl, qApiBaseUrl } = loadWebServerConfig();
  return Promise.all([
    readiness("API", apiBaseUrl),
    readiness("Q API", qApiBaseUrl),
  ]);
}

/**
 * q-api's database pool, read under the operator's own session (q-api
 * answers platform operators holding overview.read, and 404s everyone
 * else). Null when it could not be read: the console says "Not reported".
 */
export async function qApiPool(): Promise<ServicePoolDto | null> {
  const session = await qApiSession();
  if (session === null) return null;
  return getQApiOpsPool(session)
    .then((body) => body.pool)
    .catch(() => null);
}

/** This web server's deployed commit, when the host states it. */
export function webVersion(): string | null {
  const sha = process.env["RAILWAY_GIT_COMMIT_SHA"];
  return sha !== undefined && /^[0-9a-f]{7,40}$/u.test(sha)
    ? sha.slice(0, 9)
    : null;
}
