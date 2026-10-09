import Fastify, { type onRequestHookHandler } from "fastify";
import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_TTL_MS,
  createAvailabilityCache,
} from "../src/voice/live/availability-cache.js";

/**
 * V (2026-10-09): "is GPT-Live on for me?" paid the Auth server and the
 * actor database read on every ask (1.7-4.1 s under load). A repeat ask
 * with the same access token is answered from memory.
 */
function app(now: () => number) {
  const cache = createAvailabilityCache(now);
  let resolved = 0;
  // Stands for the protected-route hook (Auth server + actor resolution).
  const withContext: onRequestHookHandler = (request, _reply, done) => {
    resolved += 1;
    if (request.headers.authorization === undefined) {
      done(new Error("unauthenticated"));
      return;
    }
    done();
  };
  const server = Fastify();
  server.get(
    "/available",
    { onRequest: cache.hook(withContext) },
    (request, reply) => {
      cache.remember(request, true);
      return reply.send({ available: true });
    },
  );
  return { server, resolved: () => resolved };
}

const TOKEN_A = `Bearer ${"a".repeat(40)}`;
const TOKEN_B = `Bearer ${"b".repeat(40)}`;

describe("GPT-Live availability, remembered per access token", () => {
  it("resolves the actor once per token; a repeat ask needs neither the Auth server nor the database", async () => {
    let clock = 1_000;
    const { server, resolved } = app(() => clock);
    const ask = (authorization?: string) =>
      server.inject({
        method: "GET",
        url: "/available",
        headers: authorization === undefined ? {} : { authorization },
      });
    expect((await ask(TOKEN_A)).json()).toEqual({ available: true });
    expect((await ask(TOKEN_A)).json()).toEqual({ available: true });
    expect(resolved()).toBe(1);
    // Another token is resolved on its own.
    await ask(TOKEN_B);
    expect(resolved()).toBe(2);
    // No token: never answered from memory.
    expect((await ask()).statusCode).toBe(500);
    expect(resolved()).toBe(3);
    // Past the TTL: resolved again.
    clock += AVAILABILITY_TTL_MS + 1;
    await ask(TOKEN_A);
    expect(resolved()).toBe(4);
    await server.close();
  });
});
