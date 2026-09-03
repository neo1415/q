import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { getObservabilityContext } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type ActorContextResolution,
  type ActorContextResolver,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/** A closed security boundary: nothing authenticates, nothing resolves. */
const NO_SECURITY: ApiSecurityDependencies = {
  authenticator: { authenticate: () => Promise.resolve(null) },
  resolver: {
    resolveHumanContext: () => Promise.resolve({ status: "CONTEXT_REQUIRED" }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};
import {
  getActorContext,
  requireActorContextHook,
  type RequestAuthenticator,
} from "../src/security/actor-context.js";

// Synthetic identifiers only, parsed through their schemas so they carry the
// real brands rather than being cast into place.
const AUTH_USER_A = AuthUserIdSchema.parse(
  "a0000000-0000-4000-8000-000000000001",
);
const USER_A = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const TENANT_B = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000001",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000002",
);
const MEMBERSHIP_A = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);

const CONTEXT_A: ActorContext = {
  userId: USER_A,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MEMBERSHIP_A,
  actorType: "HUMAN",
};

/** Test doubles. Never exported from production source. */
function authenticator(
  principal: AuthenticatedPrincipal | null,
): RequestAuthenticator {
  return { authenticate: () => Promise.resolve(principal) };
}

function resolver(
  handle: (organisationId: string | undefined) => ActorContextResolution,
): ActorContextResolver {
  return {
    resolveHumanContext: (input) =>
      Promise.resolve(handle(input.selection?.organisationId)),
  };
}

/** Grants organisation A only; anything else is inaccessible. */
const organisationAOnly = resolver((organisationId) => {
  if (organisationId === undefined) {
    return { status: "CONTEXT_REQUIRED" };
  }
  if (organisationId !== ORG_A) {
    return { status: "CONTEXT_NOT_ACCESSIBLE" };
  }
  return { status: "RESOLVED", context: CONTEXT_A };
});

function buildApp(dependencies: {
  authenticator: RequestAuthenticator;
  resolver: ActorContextResolver;
}): FastifyInstance {
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), NO_SECURITY);

  app.get(
    "/__fixture/protected",
    { onRequest: requireActorContextHook(dependencies) },
    (request) => {
      const context = getActorContext(request);
      return {
        context,
        observability: getObservabilityContext(),
      };
    },
  );

  return app;
}

const AUTHENTICATED = {
  authenticator: authenticator({ authUserId: AUTH_USER_A }),
  resolver: organisationAOnly,
};

describe("protected route authentication", () => {
  it("returns 401 AUTHENTICATION_REQUIRED without a principal", async () => {
    const app = buildApp({
      authenticator: authenticator(null),
      resolver: organisationAOnly,
    });

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
    });

    expect(response.statusCode).toBe(401);
    expect(String(response.headers["content-type"])).toContain(
      "application/problem+json",
    );

    const body = response.json<{ code: string; requestId: string }>();
    expect(body.code).toBe("AUTHENTICATION_REQUIRED");
    expect(body.requestId).toBe(response.headers["x-request-id"]);
    await app.close();
  });

  it("leaves public routes unauthenticated", async () => {
    const app = buildApp({
      authenticator: authenticator(null),
      resolver: organisationAOnly,
    });

    // The security mechanism is per-route; health must not start demanding auth
    // merely because the plugin exists.
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe("protected route context resolution", () => {
  it("passes the server-resolved context to the handler", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: { "x-organisation-id": ORG_A },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ context: ActorContext }>();

    expect(body.context).toEqual(CONTEXT_A);
    await app.close();
  });

  it("returns 403 for an organisation this account cannot reach", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: { "x-organisation-id": ORG_B },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string; detail?: string }>();

    expect(body.code).toBe("PERMISSION_DENIED");
    // Must not confirm whether the organisation exists or was ever joined.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(ORG_B);
    expect(serialised.toLowerCase()).not.toContain("member");
    expect(serialised.toLowerCase()).not.toContain("exists");
    await app.close();
  });

  it("asks the caller to choose when no context was selected", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
    });

    // Never a silently chosen first membership.
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe("INVALID_REQUEST");
    expect(body.detail.toLowerCase()).toContain("organisation");
    await app.close();
  });

  it("rejects a malformed organisation selector before resolution", async () => {
    let sawResolver = false;
    const app = buildApp({
      authenticator: authenticator({ authUserId: AUTH_USER_A }),
      resolver: {
        resolveHumanContext: () => {
          sawResolver = true;
          return Promise.resolve({ status: "CONTEXT_REQUIRED" });
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: { "x-organisation-id": "not-a-uuid" },
    });

    expect(response.statusCode).toBe(400);
    expect(sawResolver).toBe(false);
    await app.close();
  });
});

describe("forged authority headers", () => {
  it("ignores client-supplied tenant, membership, role and actor type", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: {
        "x-organisation-id": ORG_A,
        // Everything below is a forgery attempt. None of it is read.
        "x-tenant-id": TENANT_B,
        "x-membership-id": "e0000000-0000-4000-8000-000000000009",
        "x-actor-role": "ADMIN",
        "x-actor-type": "SYSTEM",
        "x-user-id": "b0000000-0000-4000-8000-000000000009",
      },
    });

    expect(response.statusCode).toBe(200);
    const { context } = response.json<{ context: ActorContext }>();

    // Authority came entirely from the trusted resolver.
    expect(context.tenantId).toBe(TENANT_A);
    expect(context.tenantId).not.toBe(TENANT_B);
    expect(context.membershipId).toBe(MEMBERSHIP_A);
    expect(context.userId).toBe(USER_A);
    expect(context.actorType).toBe("HUMAN");
    expect(context).not.toHaveProperty("role");
    await app.close();
  });

  it("cannot be switched to another organisation by a forged tenant header", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: { "x-organisation-id": ORG_B, "x-tenant-id": TENANT_A },
    });

    // Forging a tenant does not make an inaccessible organisation reachable.
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("concurrent request isolation", () => {
  it("does not leak actor or observability context between tenants", async () => {
    const contextB: ActorContext = {
      userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
      tenantId: TENANT_B,
      organisationId: ORG_B,
      membershipId: MembershipIdSchema.parse(
        "e0000000-0000-4000-8000-000000000002",
      ),
      actorType: "HUMAN",
    };

    // One app serving two tenants, with a deliberate delay so the two requests
    // genuinely interleave rather than running back to back.
    const app = buildApp({
      authenticator: authenticator({ authUserId: AUTH_USER_A }),
      resolver: {
        resolveHumanContext: async (input) => {
          const wanted = input.selection?.organisationId;
          await new Promise((resolve) =>
            setTimeout(resolve, wanted === ORG_A ? 25 : 5),
          );
          if (wanted === ORG_A)
            return { status: "RESOLVED", context: CONTEXT_A };
          if (wanted === ORG_B)
            return { status: "RESOLVED", context: contextB };
          return { status: "CONTEXT_REQUIRED" };
        },
      },
    });

    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/__fixture/protected",
        headers: { "x-organisation-id": ORG_A },
      }),
      app.inject({
        method: "GET",
        url: "/__fixture/protected",
        headers: { "x-organisation-id": ORG_B },
      }),
    ]);

    const bodyA = a.json<{
      context: ActorContext;
      observability: { tenantId?: string };
    }>();
    const bodyB = b.json<{
      context: ActorContext;
      observability: { tenantId?: string };
    }>();

    expect(bodyA.context.tenantId).toBe(TENANT_A);
    expect(bodyB.context.tenantId).toBe(TENANT_B);

    // The observability scope must follow the same request, not the other one.
    expect(bodyA.observability.tenantId).toBe(TENANT_A);
    expect(bodyB.observability.tenantId).toBe(TENANT_B);
    await app.close();
  });
});

describe("observability enrichment", () => {
  it("carries only safe identifiers", async () => {
    const app = buildApp(AUTHENTICATED);

    const response = await app.inject({
      method: "GET",
      url: "/__fixture/protected",
      headers: { "x-organisation-id": ORG_A },
    });

    const { observability } = response.json<{
      observability: Record<string, unknown>;
    }>();

    expect(observability["tenantId"]).toBe(TENANT_A);
    expect(observability["organisationId"]).toBe(ORG_A);
    // No roles, titles or permissions travel into logging context.
    expect(observability).not.toHaveProperty("role");
    expect(observability).not.toHaveProperty("businessTitle");
    expect(observability).not.toHaveProperty("capabilities");
    await app.close();
  });
});
