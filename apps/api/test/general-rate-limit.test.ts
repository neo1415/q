import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { PROBLEM_CONTENT_TYPE } from "@capital-q/contracts";
import {
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  clientAddressOf,
  isPrivateAddress,
  registerGeneralRateLimit,
} from "../src/http/general-rate-limit.js";

/**
 * W1-A: the general rate limit on the api, on a bare Fastify instance with
 * a fixed clock: per person when signed in, per client address otherwise,
 * a 429 problem detail with Retry-After, and the health probes exempt.
 */
const PERSON: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  actorType: "HUMAN",
};

function app(clock: { now: number }) {
  const server = Fastify();
  // A route's own authentication sets the person before preHandler.
  server.addHook("onRequest", (request, _reply, done) => {
    if (request.headers.authorization === "Bearer person") {
      request.actorContext = PERSON;
    }
    done();
  });
  registerGeneralRateLimit(
    server,
    { perUser: 3, perAddress: 2, windowMs: 60_000 },
    () => clock.now,
  );
  server.get("/v1/thing", () => ({ ok: true }));
  server.get("/health/live", () => ({ status: "ok" }));
  return server;
}

const from = (address: string) => ({ "x-forwarded-for": address });

describe("the api's general rate limit", () => {
  it("counts a signed-in person, then answers 429 as problem details", async () => {
    const clock = { now: 1_000 };
    const server = app(clock);
    const call = () =>
      server.inject({
        method: "GET",
        url: "/v1/thing",
        headers: { authorization: "Bearer person", ...from("203.0.113.9") },
      });
    for (let i = 0; i < 3; i += 1) expect((await call()).statusCode).toBe(200);
    const refused = await call();
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
    expect(refused.headers["retry-after"]).toBe("59");
    const body: unknown = refused.json();
    expect(body).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(JSON.stringify(body)).not.toContain(PERSON.userId);
    // The next window starts afresh.
    clock.now = 61_000;
    expect((await call()).statusCode).toBe(200);
  });

  it("counts anonymous callers by address, each on its own", async () => {
    const server = app({ now: 0 });
    const get = (address: string) =>
      server.inject({
        method: "GET",
        url: "/v1/thing",
        headers: from(address),
      });
    expect((await get("203.0.113.1")).statusCode).toBe(200);
    expect((await get("203.0.113.1")).statusCode).toBe(200);
    expect((await get("203.0.113.1")).statusCode).toBe(429);
    expect((await get("203.0.113.2")).statusCode).toBe(200);
  });

  it("never limits the health probes, nor our own private network without a person", async () => {
    const server = app({ now: 0 });
    for (let i = 0; i < 10; i += 1) {
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/health/live",
            headers: from("203.0.113.5"),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/thing",
            headers: from("10.1.2.3"),
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it("reads the address the platform's edge added, not one a client prepended", () => {
    const server = Fastify();
    let seen = "";
    server.get("/x", (request) => {
      seen = clientAddressOf(request);
      return {};
    });
    return server
      .inject({
        method: "GET",
        url: "/x",
        headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
      })
      .then(() => {
        expect(seen).toBe("203.0.113.7");
        expect(isPrivateAddress("172.20.0.1")).toBe(true);
        expect(isPrivateAddress("fd12:3456::1")).toBe(true);
        expect(isPrivateAddress("203.0.113.7")).toBe(false);
      });
  });
});
