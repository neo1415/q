import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  AuthUserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type { AccessTokenAuthenticator } from "@capital-q/security/supabase";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import {
  getPrincipal,
  requireAuthenticationHook,
} from "../src/security/authentication.js";
import { createSupabaseRequestAuthenticator } from "../src/security/supabase-authenticator.js";

const AUTH_USER_A = AuthUserIdSchema.parse(
  "a0000000-0000-4000-8000-000000000001",
);
const PRINCIPAL_A: AuthenticatedPrincipal = { authUserId: AUTH_USER_A };

// Token-shaped strings; the fake authenticator decides what they mean.
const VALID_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.dmFsaWQ";
const OTHER_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.b3RoZXI";

/** Accepts exactly one token. Stands in for the Supabase Auth server. */
const accessTokens: AccessTokenAuthenticator = {
  authenticate: (token) =>
    Promise.resolve(token === VALID_TOKEN ? PRINCIPAL_A : null),
};

const NO_SECURITY: ApiSecurityDependencies = {
  authenticator: { authenticate: () => Promise.resolve(null) },
  resolver: {
    resolveHumanContext: () => Promise.resolve({ status: "CONTEXT_REQUIRED" }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};

function buildApp(): FastifyInstance {
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), NO_SECURITY);
  const authenticator = createSupabaseRequestAuthenticator(accessTokens);

  app.get(
    "/__fixture/whoami",
    { onRequest: requireAuthenticationHook({ authenticator }) },
    (request) => ({ principal: getPrincipal(request) }),
  );

  return app;
}

describe("Supabase request authentication", () => {
  it("authenticates a verified bearer token into the principal", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/whoami",
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ principal: PRINCIPAL_A });
    await app.close();
  });

  it.each([
    ["no header", {}],
    [
      "a token the Auth server rejects",
      { authorization: `Bearer ${OTHER_TOKEN}` },
    ],
    ["a non-bearer scheme", { authorization: `Basic ${VALID_TOKEN}` }],
    ["a bare token", { authorization: VALID_TOKEN }],
    ["a malformed bearer value", { authorization: "Bearer nope" }],
  ])("returns 401 AUTHENTICATION_REQUIRED with %s", async (_, headers) => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/whoami",
      headers,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe(
      "AUTHENTICATION_REQUIRED",
    );
    await app.close();
  });

  it("ignores identity claims carried anywhere but the verified token", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/__fixture/whoami?authUserId=a0000000-0000-4000-8000-000000000009",
      headers: {
        "x-auth-user-id": "a0000000-0000-4000-8000-000000000009",
        "x-user-id": "b0000000-0000-4000-8000-000000000009",
        cookie: `sb-access-token=${VALID_TOKEN}`,
      },
    });

    // A cookie is not an API credential; only the Authorization header is.
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
