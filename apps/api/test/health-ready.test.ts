import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { DatabaseHealth } from "@capital-q/database";
import type { ActorContextResolver } from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import { createApp } from "../src/app.js";

/**
 * Audit DEF-A4: readiness was a static "ok", so Railway's healthcheck let a
 * release go live with the database down. Readiness now asks the database
 * and answers 503 when it cannot; liveness still asks nothing.
 */

const security = {
  authenticator: { authenticate: () => Promise.resolve(null) },
  resolver: {
    resolveHumanContext: () =>
      Promise.resolve({ status: "CONTEXT_REQUIRED" as const }),
  } satisfies ActorContextResolver,
  identities: {
    lookup: () => Promise.resolve(null),
  } satisfies ApplicationIdentityLookup,
};

function app(database?: () => Promise<DatabaseHealth>) {
  return createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    security,
    database === undefined ? {} : { healthProbes: { database } },
  ).app;
}

describe("api readiness (DEF-A4)", () => {
  it("is 200 with the database reachable", async () => {
    const response = await app(() =>
      Promise.resolve({ reachable: true }),
    ).inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      checks: { database: "OK" },
    });
  });

  it("is 503 naming only the failure kind when the database is not", async () => {
    const response = await app(() =>
      Promise.resolve({ reachable: false, failure: "CONNECTION" }),
    ).inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      service: "api",
      environment: expect.any(String) as unknown,
      contracts: expect.any(String) as unknown,
      // W1-B: counts only; the readiness probe itself is not counted.
      traffic: { windowMinutes: 15, requests: 0, serverErrors: 0 },
      checks: { database: "CONNECTION" },
    });
  });

  it("keeps liveness free of dependency checks", async () => {
    let asked = 0;
    const response = await app(() => {
      asked += 1;
      return Promise.resolve({ reachable: false, failure: "TIMEOUT" });
    }).inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(asked).toBe(0);
  });

  it("says NOT_CHECKED, not ok-by-omission, when no probe is composed", async () => {
    const response = await app().inject({
      method: "GET",
      url: "/health/ready",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checks: { database: "NOT_CHECKED" },
    });
  });

  it("W1-B: carries the requests and server errors of the last 15 minutes, counts only", async () => {
    const server = app(() => Promise.resolve({ reachable: true }));
    server.get("/v1/boom", () => {
      throw new Error("a bug, with private words in it");
    });
    await server.inject({ method: "GET", url: "/v1/boom" });
    await server.inject({ method: "GET", url: "/v1/does-not-exist" });
    const ready = await server.inject({ method: "GET", url: "/health/ready" });
    expect(ready.json()).toMatchObject({
      traffic: { windowMinutes: 15, requests: 2, serverErrors: 1 },
    });
    expect(ready.body).not.toContain("private words");
  });

  it("W2-C step 3: carries the RLS shadow counts per schema when composed", async () => {
    const response = await createApp(
      parseApiConfig({ NODE_ENV: "test" }),
      security,
      {
        healthProbes: {
          database: () => Promise.resolve({ reachable: true }),
          rlsShadow: () => ({
            workspace: { compared: 4, wouldDeny: 1, errors: 0 },
          }),
        },
      },
    ).app.inject({ method: "GET", url: "/health/ready" });
    expect(response.json()).toMatchObject({
      status: "ok",
      rlsShadow: { workspace: { compared: 4, wouldDeny: 1, errors: 0 } },
    });
  });
});
