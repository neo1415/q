import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { MeResponseSchema, PersonProfileDtoSchema } from "@capital-q/contracts";
import {
  effectivePersonChanges,
  PersonProfileNotFoundError,
  PersonProfileVersionConflictError,
  type PersonProfile,
  type PersonProfileStore,
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

/**
 * The person's own editable profile (BIZ-002). An in-memory double of the
 * one person-profile store, with the store's rules: optimistic version,
 * idempotent replay, active profiles only. The rules themselves are proven
 * against the database in @capital-q/security; this proves the route never
 * lets a caller reach anyone's profile but their own.
 */
function peopleDouble() {
  const USER_B = UserIdSchema.parse("b0000000-0000-4000-8000-000000000002");
  const rows = new Map<string, PersonProfile>([
    [
      USER_A,
      {
        userId: USER_A,
        displayName: "Person A",
        headline: null,
        version: 1,
        updatedAt: "2026-09-25T09:00:00.000Z",
      },
    ],
    [
      USER_B,
      {
        userId: USER_B,
        displayName: "Person B",
        headline: "Partner",
        version: 1,
        updatedAt: "2026-09-25T09:00:00.000Z",
      },
    ],
  ]);
  const people: PersonProfileStore = {
    read: (userId) => Promise.resolve(rows.get(userId) ?? null),
    update: ({ userId, expectedVersion, changes }) => {
      const current = rows.get(userId);
      if (current === undefined) {
        return Promise.reject(new PersonProfileNotFoundError());
      }
      const effective = effectivePersonChanges(current, changes);
      if (Object.keys(effective).length === 0) return Promise.resolve(current);
      if (current.version !== expectedVersion) {
        return Promise.reject(
          new PersonProfileVersionConflictError(current.version),
        );
      }
      const next: PersonProfile = {
        ...current,
        ...(effective.displayName === undefined
          ? {}
          : { displayName: effective.displayName }),
        ...(effective.headline === undefined
          ? {}
          : { headline: effective.headline }),
        version: current.version + 1,
      };
      rows.set(userId, next);
      return Promise.resolve(next);
    },
  };
  return { people, rows, USER_B };
}

describe("GET/PATCH /v1/me/profile (BIZ-002)", () => {
  function profileApp(people: PersonProfileStore) {
    return buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: noMembership,
      identities: identityA,
      people,
    });
  }

  it("is 401 without a session and never reaches the store", async () => {
    const { people } = peopleDouble();
    const app = buildApp({
      authenticator: authenticator(null),
      resolver: noMembership,
      identities: identityA,
      people,
    });
    const read = await app.inject({ method: "GET", url: "/v1/me/profile" });
    const write = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, headline: "x" },
    });
    expect(read.statusCode).toBe(401);
    expect(write.statusCode).toBe(401);
    await app.close();
  });

  it("reads the session's own profile, needing no organisation", async () => {
    const { people } = peopleDouble();
    const app = profileApp(people);
    const response = await app.inject({ method: "GET", url: "/v1/me/profile" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(PersonProfileDtoSchema.parse(response.json())).toEqual({
      userId: USER_A,
      displayName: "Person A",
      headline: null,
      version: 1,
      updatedAt: "2026-09-25T09:00:00.000Z",
    });
    await app.close();
  });

  it("edits the session's own profile at the version read, and only theirs", async () => {
    const { people, rows, USER_B } = peopleDouble();
    const app = profileApp(people);
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, headline: "Founder, Kivu Freight" },
    });
    expect(response.statusCode).toBe(200);
    expect(PersonProfileDtoSchema.parse(response.json())).toMatchObject({
      headline: "Founder, Kivu Freight",
      version: 2,
    });
    // The other person is untouched.
    expect(rows.get(USER_B)).toMatchObject({ headline: "Partner", version: 1 });
    await app.close();
  });

  it("refuses a user id, or any field outside the contract, in the body", async () => {
    const { people, rows, USER_B } = peopleDouble();
    const app = profileApp(people);
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, userId: USER_B, headline: "Hijacked" },
    });
    expect(response.statusCode).toBe(422);
    expect(rows.get(USER_B)?.headline).toBe("Partner");
    expect(rows.get(USER_A)?.version).toBe(1);
    await app.close();
  });

  it("answers a stale version with VERSION_CONFLICT and keeps the newer value", async () => {
    const { people, rows } = peopleDouble();
    const app = profileApp(people);
    await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, headline: "Angel investor" },
    });
    const stale = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, headline: "Something else" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe("VERSION_CONFLICT");
    expect(rows.get(USER_A)).toMatchObject({
      headline: "Angel investor",
      version: 2,
    });
    await app.close();
  });

  it("treats a retried request as idempotent: same answer, no second version", async () => {
    const { people } = peopleDouble();
    const app = profileApp(people);
    const request = {
      method: "PATCH" as const,
      url: "/v1/me/profile",
      payload: { expectedVersion: 1, displayName: "Ada" },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{ version: number }>().version).toBe(2);
    await app.close();
  });

  it("validates bounds: an empty name and an overlong headline are refused", async () => {
    const { people } = peopleDouble();
    const app = profileApp(people);
    for (const payload of [
      { expectedVersion: 1, displayName: "   " },
      { expectedVersion: 1, headline: "x".repeat(161) },
      { expectedVersion: 1 },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/v1/me/profile",
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
    await app.close();
  });

  it("is 403 for a session with no application identity", async () => {
    const { people } = peopleDouble();
    const app = buildApp({
      authenticator: authenticator(PRINCIPAL_A),
      resolver: noMembership,
      identities: noIdentity,
      people,
    });
    const response = await app.inject({ method: "GET", url: "/v1/me/profile" });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keeps PATCH /v1/me working through the same store", async () => {
    const { people, rows } = peopleDouble();
    const app = profileApp(people);
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      payload: { displayName: "Ada" },
    });
    expect(response.statusCode).toBe(204);
    expect(rows.get(USER_A)).toMatchObject({ displayName: "Ada", version: 2 });
    await app.close();
  });
});
