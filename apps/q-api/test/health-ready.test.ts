import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { DatabaseHealth } from "@capital-q/database";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/** Audit DEF-A4: q-api's readiness asks the database; liveness does not. */

const security: QApiSecurityDependencies = {
  authenticator: { authenticate: () => Promise.resolve(null) },
};

function app(database?: () => Promise<DatabaseHealth>) {
  return createApp(
    parseQApiConfig({ NODE_ENV: "test" }),
    security,
    database === undefined ? {} : { healthProbes: { database } },
  ).app;
}

describe("q-api readiness (DEF-A4)", () => {
  it("is 200 with the database reachable", async () => {
    const response = await app(() =>
      Promise.resolve({ reachable: true }),
    ).inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "q-api",
      checks: { database: "OK" },
    });
  });

  it("is 503 when the database times out, and says only TIMEOUT", async () => {
    const response = await app(() =>
      Promise.resolve({ reachable: false, failure: "TIMEOUT" }),
    ).inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "unavailable",
      checks: { database: "TIMEOUT" },
    });
  });

  it("keeps liveness free of dependency checks", async () => {
    let asked = 0;
    const response = await app(() => {
      asked += 1;
      return Promise.resolve({ reachable: true });
    }).inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(asked).toBe(0);
  });
});
