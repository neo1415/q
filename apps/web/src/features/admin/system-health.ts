import "server-only";

import { loadWebServerConfig } from "@capital-q/config/web";

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
};

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

/** This web server's deployed commit, when the host states it. */
export function webVersion(): string | null {
  const sha = process.env["RAILWAY_GIT_COMMIT_SHA"];
  return sha !== undefined && /^[0-9a-f]{7,40}$/u.test(sha)
    ? sha.slice(0, 9)
    : null;
}
