import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  AuthUserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type { AccessTokenAuthenticator } from "@capital-q/security/supabase";

import { createApp } from "../src/app.js";
import {
  getPrincipal,
  requireAuthenticationHook,
} from "../src/security/authentication.js";
import { createSupabaseRequestAuthenticator } from "../src/security/supabase-authenticator.js";

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const VALID_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.dmFsaWQ";

const accessTokens: AccessTokenAuthenticator = {
  authenticate: (token) =>
    Promise.resolve(token === VALID_TOKEN ? PRINCIPAL : null),
};

describe("Q API authentication boundary", () => {
  it("makes the verified human boundary available to route registration", async () => {
    const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), {
      authenticator: createSupabaseRequestAuthenticator(accessTokens),
    });

    app.get(
      "/__fixture/q-protected",
      {
        onRequest: requireAuthenticationHook({
          authenticator: app.security.authenticator,
        }),
      },
      (request) => ({ principal: getPrincipal(request) }),
    );

    const denied = await app.inject({
      method: "GET",
      url: "/__fixture/q-protected",
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json<{ code: string }>().code).toBe(
      "AUTHENTICATION_REQUIRED",
    );

    const allowed = await app.inject({
      method: "GET",
      url: "/__fixture/q-protected",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ principal: PRINCIPAL });

    // Health stays public; the boundary is per route.
    const health = await app.inject({ method: "GET", url: "/health/live" });
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
