import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  createIntegrationsService,
  createTokenCipher,
} from "@capital-q/integrations";
import {
  createFakeEmailProvider,
  createFakeGoogleOAuth,
  createInMemoryIntegrationsStore,
  createRecordingActivityWriter,
  FAKE_REFRESH_TOKEN,
  inlineTransactions,
} from "@capital-q/integrations/testing";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * /v1/integrations/google (BIZ-007) over fastify.inject: connect and the
 * callback bind to the person by one-time state, status and disconnect are
 * the person's own, no response carries a token, and the Gmail push is
 * accepted only with Google's token for our audience and push account.
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
const AUDIENCE =
  "https://capital-qapi-production.up.railway.app/v1/integrations/google/gmail-push";
const PUSH_ACCOUNT = "gmail-push@capital-q.iam.gserviceaccount.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "k1" } as {
  kid: string;
  kty: "RSA";
  n: string;
  e: string;
};

function pushToken(aud: string): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "RS256", kid: "k1" })}.${part({
    iss: "https://accounts.google.com",
    aud,
    email: PUSH_ACCOUNT,
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
  })}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

function build(options: { readonly webOrigin?: string | undefined } = {}) {
  const oauth = createFakeGoogleOAuth();
  const integrations = createIntegrationsService({
    store: createInMemoryIntegrationsStore(),
    transactions: inlineTransactions,
    activity: createRecordingActivityWriter(),
    google: {
      oauth,
      cipher: createTokenCipher(randomBytes(32).toString("base64")),
      email: createFakeEmailProvider(),
    },
  });
  const security: ApiSecurityDependencies = {
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
    identities: {
      lookup: () =>
        Promise.resolve({ userId: CONTEXT.userId, displayName: "Ben" }),
    },
  };
  const app = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    integrations: {
      integrations,
      webOrigin:
        "webOrigin" in options
          ? options.webOrigin
          : "https://app.example.invalid",
      push: {
        audience: AUDIENCE,
        serviceAccountEmail: PUSH_ACCOUNT,
        keys: () => Promise.resolve([JWK]),
      },
    },
  }).app;
  return { app, oauth };
}

describe("/v1/integrations/google", () => {
  it("connects through the one-time state and never returns a token", async () => {
    const { app, oauth } = build();
    const before = await app.inject({
      method: "GET",
      url: "/v1/integrations/google",
    });
    expect(before.json()).toEqual({ status: "NOT_CONNECTED" });

    const started = await app.inject({
      method: "POST",
      url: "/v1/integrations/google/connect",
      payload: { returnTo: "/settings" },
    });
    expect(started.statusCode).toBe(200);
    const state = new URL(
      started.json<{ authorizationUrl: string }>().authorizationUrl,
    ).searchParams.get("state");

    const callback = await app.inject({
      method: "GET",
      url: `/v1/integrations/google/callback?state=${state ?? ""}&code=4%2Fcode-0123456789abcdef`,
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe(
      "https://app.example.invalid/settings?google=connected",
    );
    const replay = await app.inject({
      method: "GET",
      url: `/v1/integrations/google/callback?state=${state ?? ""}&code=4%2Fcode-0123456789abcdef`,
    });
    expect(replay.headers.location).toContain("google=failed");

    const after = await app.inject({
      method: "GET",
      url: "/v1/integrations/google",
    });
    expect(after.json()).toMatchObject({ status: "CONNECTED" });
    for (const response of [started, callback, after]) {
      expect(response.body).not.toContain(FAKE_REFRESH_TOKEN);
    }

    const gone = await app.inject({
      method: "DELETE",
      url: "/v1/integrations/google",
    });
    expect(gone.statusCode).toBe(204);
    expect(oauth.revoked).toHaveLength(1);
    await app.close();
  });

  it("accepts a Gmail push only with Google's token for our audience", async () => {
    const { app } = build();
    const payload = {
      message: {
        data: Buffer.from(
          JSON.stringify({
            emailAddress: "nobody@example.invalid",
            historyId: 5,
          }),
        ).toString("base64"),
        messageId: "1",
      },
      subscription: "projects/capital-q/subscriptions/gmail-replies-push",
    };
    const good = await app.inject({
      method: "POST",
      url: "/v1/integrations/google/gmail-push",
      headers: { authorization: `Bearer ${pushToken(AUDIENCE)}` },
      payload,
    });
    expect(good.statusCode).toBe(204);
    const badAudience = await app.inject({
      method: "POST",
      url: "/v1/integrations/google/gmail-push",
      headers: {
        authorization: `Bearer ${pushToken("https://evil.example/v1/integrations/google/gmail-push")}`,
      },
      payload,
    });
    expect(badAudience.statusCode).toBe(401);
    const none = await app.inject({
      method: "POST",
      url: "/v1/integrations/google/gmail-push",
      payload,
    });
    expect(none.statusCode).toBe(401);
    await app.close();
  });
});

describe("an unconfigured web origin", () => {
  it("never redirects the browser to a guessed address: the callback answers unavailable", async () => {
    const { app } = build({ webOrigin: undefined });
    const callback = await app.inject({
      method: "GET",
      url: "/v1/integrations/google/callback?state=s&code=c",
    });
    expect(callback.statusCode).not.toBe(303);
    expect(callback.headers.location).toBeUndefined();
    expect(callback.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
