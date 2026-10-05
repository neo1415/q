import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import {
  Q_VOICE_SESSIONS_PATH,
  qVoiceDuplexEndPath,
  qVoiceDuplexRejoinPath,
  qVoiceDuplexToolPath,
} from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import type { DuplexBroker } from "../src/voice/duplex/broker.js";
import { createDeepgramVoiceProvider } from "../src/voice/providers/deepgram.js";
import { registerQVoiceRoutes } from "../src/voice/routes.js";

/**
 * DUPLEX at the session route: offered on top of the standard line, never
 * instead of it. Whatever the broker does — mint, fall back, throw — the
 * person gets a working standard credential. No live provider call: the
 * speech provider's fetch is a fake.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

/** Shaped like a session JWT; never echoed back. */
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

const CREDENTIAL = {
  clientSecret: "ek_fake_secret",
  callsUrl: "https://realtime.invalid/v1/realtime/calls",
  expiresAt: "2026-10-04T12:01:00.000Z",
  maxSessionMs: 600_000,
  idleMs: 30_000,
};

function fakeBroker(
  open: DuplexBroker["open"],
): DuplexBroker & { readonly open: ReturnType<typeof vi.fn> } {
  return {
    enabled: true,
    open: vi.fn(open),
    tool: () => Promise.resolve(null),
    usage: () => Promise.resolve(null),
    rejoin: () => Promise.resolve(null),
    end: () => false,
    size: () => 0,
  };
}

async function app(duplex: DuplexBroker | undefined): Promise<FastifyInstance> {
  const server = Fastify();
  registerQVoiceRoutes(server, {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: ACTOR }),
    },
    bindings: createVoiceSessionBindings(),
    deepgram: createDeepgramVoiceProvider({
      apiKey: "disabled-locally-000000000000",
      publicUrl: "https://q-api.invalid",
      thinkPath: "/v1/q/voice/think",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ access_token: "dg_fake" }), {
            status: 200,
          }),
        ),
    }),
    duplex,
  });
  await server.ready();
  return server;
}

const open = (server: FastifyInstance, payload: object = {}) =>
  server.inject({
    method: "POST",
    url: Q_VOICE_SESSIONS_PATH,
    headers: { authorization: `Bearer ${BEARER}` },
    payload: { conversationId: undefined, ...payload },
  });

describe("the voice session route with duplex", () => {
  it("adds the duplex line to a complete standard credential", async () => {
    const broker = fakeBroker(() =>
      Promise.resolve({ kind: "DUPLEX", credential: CREDENTIAL }),
    );
    const server = await app(broker);
    const response = await open(server);
    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(body.duplex).toEqual(CREDENTIAL);
    // The standard line is all there for an instant fallback.
    expect(body.provider).toBe("deepgram");
    expect(body.token).toBe("dg_fake");
    expect(body.deepgram).toBeDefined();
    expect(response.body).not.toContain("disabled-locally");
    expect(response.body).not.toContain(BEARER);
    expect(broker.open).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("is the standard line, unchanged, when the broker falls back", async () => {
    const server = await app(
      fakeBroker(() =>
        Promise.resolve({ kind: "FALLBACK", reason: "CAP_REACHED" }),
      ),
    );
    const response = await open(server);
    expect(response.statusCode).toBe(201);
    expect(response.json<Record<string, unknown>>().duplex).toBeUndefined();
    await server.close();
  });

  it("is the standard line when the broker throws", async () => {
    const server = await app(
      fakeBroker(() => Promise.reject(new Error("network"))),
    );
    const response = await open(server);
    expect(response.statusCode).toBe(201);
    expect(response.json<Record<string, unknown>>().duplex).toBeUndefined();
    await server.close();
  });

  it("does not try duplex when the browser asks for the standard line", async () => {
    const broker = fakeBroker(() =>
      Promise.resolve({ kind: "DUPLEX", credential: CREDENTIAL }),
    );
    const server = await app(broker);
    const response = await open(server, { duplex: false });
    expect(response.statusCode).toBe(201);
    expect(broker.open).not.toHaveBeenCalled();
    await server.close();
  });

  it("refuses a client that tries to turn duplex on itself", async () => {
    const server = await app(undefined);
    const response = await open(server, { duplex: true });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await server.close();
  });

  it("answers a line it does not hold with not found", async () => {
    const server = await app(
      fakeBroker(() => Promise.resolve({ kind: "FALLBACK", reason: "OFF" })),
    );
    const id = "5f000000-0000-4000-8000-000000000001";
    const tool = await server.inject({
      method: "POST",
      url: qVoiceDuplexToolPath(id),
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { callId: "c1", name: "ask_q", arguments: "{}" },
    });
    expect(tool.statusCode).toBe(404);
    const end = await server.inject({
      method: "POST",
      url: qVoiceDuplexEndPath(id),
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { reason: "ENDED" },
    });
    expect(end.statusCode).toBe(204);
    const rejoin = await server.inject({
      method: "POST",
      url: qVoiceDuplexRejoinPath(id),
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { cause: "NETWORK" },
    });
    expect(rejoin.statusCode).toBe(404);
    // I1: why it ended and what the line measured ride along.
    const measured = await server.inject({
      method: "POST",
      url: qVoiceDuplexEndPath(id),
      headers: { authorization: `Bearer ${BEARER}` },
      payload: {
        reason: "FALLBACK",
        cause: "NETWORK",
        stats: {
          rejoins: 2,
          weakSeconds: 14,
          worstLossPct: 31.5,
          worstJitterMs: 240,
          worstRttMs: 1900,
          firstAudioMsP50: 640,
          firstAudioMsMax: 1800,
          turns: 9,
        },
      },
    });
    expect(measured.statusCode).toBe(204);
    // A cause outside the contract never reaches the broker.
    const bogus = await server.inject({
      method: "POST",
      url: qVoiceDuplexRejoinPath(id),
      headers: { authorization: `Bearer ${BEARER}` },
      payload: { cause: "BECAUSE" },
    });
    expect(bogus.statusCode).toBeGreaterThanOrEqual(400);
    await server.close();
  });
});
