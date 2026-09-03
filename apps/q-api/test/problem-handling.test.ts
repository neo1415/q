import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";

import { createApp } from "../src/app.js";

/**
 * The Q API carries its own copy of the thin Fastify wiring, because the
 * architecture keeps framework mapping inside each deployable rather than in a
 * shared HTTP package. That duplication is only safe if it is checked, so these
 * tests assert the Q API produces the same wire contract as the application API.
 *
 * No Q routes are created here; a fixture exercises the shared error boundary.
 */
function buildTestApp() {
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), {
    authenticator: { authenticate: () => Promise.resolve(null) },
  });

  app.get("/__fixture/boom", () => {
    // Synthetic only.
    throw new Error(
      "SELECT * FROM q_runs; conn=postgres://admin:super-secret-test-value@db.internal:5432/capitalq",
    );
  });

  return app;
}

describe("q-api problem contract parity", () => {
  it("returns the same 404 problem shape as the application API", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/does-not-exist",
    });

    expect(response.statusCode).toBe(404);
    const contentType = response.headers["content-type"];
    expect(typeof contentType === "string" ? contentType : "").toContain(
      "application/problem+json",
    );

    const body = response.json<Record<string, unknown>>();
    expect(body["code"]).toBe("RESOURCE_NOT_FOUND");
    expect(body["type"]).toBe("urn:capitalq:problem:resource-not-found");
    await app.close();
  });

  it("redacts internal detail on an unexpected error", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/boom",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("SELECT");
    expect(response.body).not.toContain("postgres://");
    expect(response.body).not.toContain("super-secret-test-value");
    expect(response.json<{ code: string }>().code).toBe(
      "INTERNAL_SERVER_ERROR",
    );
    await app.close();
  });

  it("exposes a matching X-Request-Id in the same format", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/nope" });

    const body = response.json<{ requestId: string }>();
    expect(body.requestId).toBe(response.headers["x-request-id"]);
    expect(body.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    await app.close();
  });
});
