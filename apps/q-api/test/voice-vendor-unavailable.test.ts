import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import { ModelProviderFailure } from "@capital-q/model-gateway";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { createVoiceSessionBindings } from "../src/voice/bindings.js";
import { DeepgramTokenError } from "../src/voice/providers/deepgram.js";
import type { RealtimeVoiceProvider } from "../src/voice/provider.js";

/**
 * Recovery G-D9: starting a voice session while the speech vendor cannot
 * be reached was a 500 "unhandled request error". It is a classified
 * 503 PROVIDER_UNAVAILABLE now, retryable when trying again may work, and
 * nothing about the vendor (host, message, key) reaches the response.
 */

const CONTEXT: ActorContext = {
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
const PROVIDER_KEY = "sk_PROVIDER-SECRET-NEVER-EMITTED";

function unreachable(): Error {
  // What undici throws when the vendor's host refuses the connection.
  return new TypeError("fetch failed", {
    cause: Object.assign(
      new Error("connect ECONNREFUSED 10.9.8.7:443 speech.vendor.invalid"),
      { code: "ECONNREFUSED" },
    ),
  });
}

function app(failure: () => Error) {
  const provider: RealtimeVoiceProvider = {
    name: "fake-speech-engine",
    voices: ["FEMALE", "MALE"],
    createSession: () => Promise.reject(failure()),
    attach: () => Promise.resolve({ close: () => Promise.resolve() }),
  };
  const security: QApiSecurityDependencies = {
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
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  return createApp(
    parseQApiConfig({ NODE_ENV: "test", ELEVENLABS_API_KEY: PROVIDER_KEY }),
    security,
    { voice: { provider, bindings: createVoiceSessionBindings() } },
  ).app;
}

async function start(failure: () => Error) {
  const server = app(failure);
  const response = await server.inject({
    method: "POST",
    url: "/v1/q/voice/sessions",
    headers: { authorization: "Bearer eyPRIVATE.NEVER-EMITTED.bearer" },
    payload: { voice: "FEMALE" },
  });
  await server.close();
  return response;
}

describe("a voice session whose vendor fails (G-D9)", () => {
  it("vendor unreachable: 503 provider-unavailable, retryable, nothing about the vendor", async () => {
    const response = await start(unreachable);
    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json()).toMatchObject({
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
    });
    for (const secret of [
      "10.9.8.7",
      "vendor.invalid",
      PROVIDER_KEY,
      "fetch failed",
    ]) {
      expect(response.body).not.toContain(secret);
    }
  });

  it("vendor too slow: 503, retryable", async () => {
    const response = await start(() =>
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
  });

  it("vendor refused with a server error: 503, retryable", async () => {
    const response = await start(() => new DeepgramTokenError(502));
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
  });

  it("vendor refused our key: 503 without Retry-After (trying again will not help)", async () => {
    const response = await start(
      () =>
        new ModelProviderFailure("openai realtime secret refused", {
          failureClass: "AUTHENTICATION",
          providerCode: "openai",
          providerStatus: 401,
        }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBeUndefined();
  });

  it("an error of our own is still the generic 500", async () => {
    const response = await start(() => new Error("a bug"));
    expect(response.statusCode).toBe(500);
  });
});
