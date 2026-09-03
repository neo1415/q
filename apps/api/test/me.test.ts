import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { MeResponseSchema } from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContextResolution,
  type ActorContextResolver,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import type { RequestAuthenticator } from "../src/security/actor-context.js";

const AUTH_USER_A = AuthUserIdSchema.parse(
  "a0000000-0000-4000-8000-000000000001",
);
const USER_A = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000001",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000002",
);
const MEMBERSHIP_A = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);

const PRINCIPAL_A: AuthenticatedPrincipal = { authUserId: AUTH_USER_A };

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

const identityA: ApplicationIdentityLookup = {
  lookup: (principal) =>
    Promise.resolve(
      principal.authUserId === AUTH_USER_A
        ? { userId: USER_A, displayName: "Person A" }
        : null,
    ),
};

const noIdentity: ApplicationIdentityLookup = {
  lookup: () => Promise.resolve(null),
};

/** Member of organisation A with a persisted active context. */
const memberOfA = resolver((organisationId) => {
  if (organisationId !== undefined && organisationId !== ORG_A) {
    return { status: "CONTEXT_NOT_ACCESSIBLE" };
  }
  return {
    status: "RESOLVED",
    context: {
      userId: USER_A,
      tenantId: TENANT_A,
      organisationId: ORG_A,
      membershipId: MEMBERSHIP_A,
      actorType: "HUMAN",
    },
  };
});

/** A person with no membership at all, or a revoked one. */
const noMembership = resolver((organisationId) =>
  organisationId === undefined
    ? { status: "CONTEXT_REQUIRED" }
    : { status: "CONTEXT_NOT_ACCESSIBLE" },
);

function buildApp(security: ApiSecurityDependencies): FastifyInstance {
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security).app;
}

describe("GET /v1/me", () => {
  it("is 401 without a verified session", async () => {
    const app = buildApp({
      authenticator: authenticator(null),
      resolver: memberOfA,
      identities: identityA,
    });
    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(401);
    expect(response.json<{ code: string }>().code).toBe(
      "AUTHENTICATION_REQUIRED",
    );
    await app.close();
  });

  it("returns the Person and CONTEXT_REQUIRED for a user with no membership (never 401)", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: noMembership,
      identities: identityA,
    });
    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = MeResponseSchema.parse(response.json());
    expect(body.user).toEqual({ id: USER_A, displayName: "Person A" });
    expect(body.context).toEqual({ status: "CONTEXT_REQUIRED" });
    // The auth subject is never the user id, and never on the wire.
    expect(JSON.stringify(body)).not.toContain(AUTH_USER_A);
    await app.close();
  });

  it("returns the server-resolved context when one exists", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: memberOfA,
      identities: identityA,
    });
    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(200);
    const body = MeResponseSchema.parse(response.json());
    expect(body.context).toEqual({
      status: "RESOLVED",
      tenantId: TENANT_A,
      organisationId: ORG_A,
      membershipId: MEMBERSHIP_A,
    });
    await app.close();
  });

  it("answers a selector for an inaccessible organisation with the same 403 as a non-existent one", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: memberOfA,
      identities: identityA,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-organisation-id": ORG_B },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
    await app.close();
  });

  it("rejects a malformed selector before any lookup", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: memberOfA,
      identities: identityA,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { "x-organisation-id": "not-a-uuid" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("is 403 for a valid session with no application identity", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: noMembership,
      identities: noIdentity,
    });
    const response = await app.inject({ method: "GET", url: "/v1/me" });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("does not let the client name its own tenant, membership or user", async () => {
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: noMembership,
      identities: identityA,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        "x-tenant-id": TENANT_A,
        "x-membership-id": MEMBERSHIP_A,
        "x-user-id": "b0000000-0000-4000-8000-000000000009",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = MeResponseSchema.parse(response.json());
    expect(body.user.id).toBe(USER_A);
    expect(body.context).toEqual({ status: "CONTEXT_REQUIRED" });
    await app.close();
  });
});
