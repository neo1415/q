import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  OrganisationCreationConflictError,
  OrganisationNotFoundError,
  OrganisationVersionConflictError,
  type MembershipView,
  type Organisation,
  type OrganisationService,
} from "@capital-q/organisations";
import {
  ActorContextDeniedError,
  AuthorizationDeniedError,
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * HTTP adaptation of the organisation service: authentication and context
 * hooks, contract validation (including refusal of authority fields), and
 * error mapping. The service itself is a recording double; its behaviour is
 * proven against the database in the organisations package.
 */

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
const IDEMPOTENCY_KEY = "11111111-2222-4333-8444-555555555555";

const CONTEXT_A: ActorContext = {
  userId: USER_A,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MEMBERSHIP_A,
  actorType: "HUMAN",
};

const ORGANISATION_A: Organisation = {
  id: ORG_A,
  tenantId: TENANT_A,
  organisationType: "company",
  displayName: "Acme",
  legalName: null,
  slug: "acme",
  websiteUrl: null,
  countryCode: null,
  jurisdictionCode: null,
  status: "active",
  version: 1,
  createdAt: "2026-09-03T09:00:00.000Z",
  updatedAt: "2026-09-03T09:00:00.000Z",
};

const VIEW_A: MembershipView = {
  organisation: ORGANISATION_A,
  membership: {
    id: MEMBERSHIP_A,
    tenantId: TENANT_A,
    organisationId: ORG_A,
    userId: USER_A,
    status: "active",
    joinedAt: "2026-09-03T09:00:00.000Z",
  },
  roleCodes: ["organisation_admin"],
  isActiveContext: true,
};

type Calls = { create: unknown[]; update: unknown[]; activate: unknown[] };

function fakeService(overrides: Partial<OrganisationService> = {}): {
  service: OrganisationService;
  calls: Calls;
} {
  const calls: Calls = { create: [], update: [], activate: [] };
  const service: OrganisationService = {
    createOrganisation: (command) => {
      calls.create.push(command);
      return Promise.resolve(VIEW_A);
    },
    listMyOrganisations: () =>
      Promise.resolve({ items: [VIEW_A], nextCursor: "next-cursor" }),
    getOrganisation: () => Promise.resolve(ORGANISATION_A),
    updateOrganisation: (command) => {
      calls.update.push(command);
      return Promise.resolve({ ...ORGANISATION_A, version: 2 });
    },
    activateOrganisation: (command) => {
      calls.activate.push(command);
      return Promise.resolve({ view: VIEW_A, context: CONTEXT_A });
    },
    ...overrides,
  };
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: OrganisationService;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: options.context },
        ),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    organisations: options.service,
  }).app;
}

const VALID_CREATE = { displayName: "Acme", organisationType: "company" };

describe("POST /v1/organisations", () => {
  it("requires authentication and calls nothing without it", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: VALID_CREATE,
    });
    expect(response.statusCode).toBe(401);
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it("requires an Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations",
      payload: VALID_CREATE,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe("VALIDATION_FAILED");
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it.each([
    ["tenantId", { tenantId: TENANT_A }],
    ["organisationId", { organisationId: ORG_A }],
    ["membershipId", { membershipId: MEMBERSHIP_A }],
    ["roleId", { roleId: "11111111-1111-4111-8111-111111111111" }],
    ["role", { role: "organisation_admin" }],
    ["capabilities", { capabilities: ["organisation.admin"] }],
    ["isAdmin", { isAdmin: true }],
    ["verified", { verified: true }],
    ["status", { status: "active" }],
    ["createdByUserId", { createdByUserId: USER_A }],
    ["slug", { slug: "acme" }],
  ])("refuses the authority field %s by contract", async (_, extra) => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: { ...VALID_CREATE, ...extra },
    });
    expect(response.statusCode).toBe(422);
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it("creates with 201, Location and a safe summary, without organisation context", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: { ...VALID_CREATE, websiteUrl: "https://acme.example" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["location"]).toBe(`/v1/organisations/${ORG_A}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<{
      organisation: Record<string, unknown>;
      membership: Record<string, unknown>;
    }>();
    expect(body.organisation["id"]).toBe(ORG_A);
    expect(body.organisation).not.toHaveProperty("tenantId");
    expect(body.organisation).not.toHaveProperty("slug");
    expect(body.membership["roleCodes"]).toEqual(["organisation_admin"]);
    expect(body.membership).not.toHaveProperty("tenantId");
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]).toMatchObject({
      principal: PRINCIPAL_A,
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        displayName: "Acme",
        organisationType: "company",
        websiteUrl: "https://acme.example",
      },
    });
    expect(
      String((calls.create[0] as { correlationId: string }).correlationId),
    ).toMatch(/^cor_/);
    await app.close();
  });

  it("maps an idempotency conflict to 409 IDEMPOTENCY_CONFLICT", async () => {
    const { service } = fakeService({
      createOrganisation: () =>
        Promise.reject(new OrganisationCreationConflictError()),
    });
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations",
      headers: { "idempotency-key": IDEMPOTENCY_KEY },
      payload: VALID_CREATE,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("IDEMPOTENCY_CONFLICT");
    await app.close();
  });
});

describe("GET /v1/organisations", () => {
  it("lists the caller's memberships with an opaque cursor, without context", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "GET",
      url: "/v1/organisations?limit=5",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: unknown[]; nextCursor: string }>();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBe("next-cursor");
    await app.close();
  });

  it("refuses userId and tenantId selectors and invalid page sizes", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    for (const url of [
      "/v1/organisations?userId=b0000000-0000-4000-8000-000000000009",
      "/v1/organisations?tenantId=c0000000-0000-4000-8000-000000000009",
      "/v1/organisations?limit=0",
      "/v1/organisations?limit=1000",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(422);
    }
    await app.close();
  });
});

describe("GET/PATCH /v1/organisations/:organisationId", () => {
  it("fails closed without a resolved organisation context", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/organisations/${ORG_A}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("returns the organisation DTO for the current context", async () => {
    const { service } = fakeService();
    const app = buildApp({
      principal: PRINCIPAL_A,
      context: CONTEXT_A,
      service,
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/organisations/${ORG_A}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ id: string; version: number }>()).toMatchObject({
      id: ORG_A,
      version: 1,
    });
    await app.close();
  });

  it("maps not-found, permission denial and version conflict", async () => {
    const cases: [Error, number, string][] = [
      [new OrganisationNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
      [
        new AuthorizationDeniedError("NO_MATCHING_GRANT"),
        403,
        "PERMISSION_DENIED",
      ],
      [new OrganisationVersionConflictError(2), 409, "VERSION_CONFLICT"],
    ];
    for (const [error, status, code] of cases) {
      const { service } = fakeService({
        updateOrganisation: () => Promise.reject(error),
        getOrganisation: () => Promise.reject(error),
      });
      const app = buildApp({
        principal: PRINCIPAL_A,
        context: CONTEXT_A,
        service,
      });
      const patch = await app.inject({
        method: "PATCH",
        url: `/v1/organisations/${ORG_B}`,
        payload: { expectedVersion: 1, displayName: "New" },
      });
      expect(patch.statusCode, error.name).toBe(status);
      expect(patch.json<{ code: string }>().code).toBe(code);
      const get = await app.inject({
        method: "GET",
        url: `/v1/organisations/${ORG_B}`,
      });
      expect(get.statusCode, error.name).toBe(status);
      await app.close();
    }
  });

  it.each([
    ["no expectedVersion", { displayName: "New" }],
    ["no editable field", { expectedVersion: 1 }],
    ["organisationType", { expectedVersion: 1, organisationType: "company" }],
    ["status", { expectedVersion: 1, status: "closed" }],
    ["tenantId", { expectedVersion: 1, tenantId: TENANT_A }],
    ["slug", { expectedVersion: 1, slug: "x" }],
    ["verified", { expectedVersion: 1, verified: true }],
  ])("refuses an update with %s", async (_, payload) => {
    const { service, calls } = fakeService();
    const app = buildApp({
      principal: PRINCIPAL_A,
      context: CONTEXT_A,
      service,
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/organisations/${ORG_A}`,
      payload,
    });
    expect(response.statusCode).toBe(422);
    expect(calls.update).toHaveLength(0);
    await app.close();
  });

  it("passes a valid update through and returns the new version", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({
      principal: PRINCIPAL_A,
      context: CONTEXT_A,
      service,
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/organisations/${ORG_A}`,
      payload: { expectedVersion: 1, displayName: "Acme Ltd", legalName: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ version: number }>().version).toBe(2);
    expect(calls.update[0]).toMatchObject({
      actor: CONTEXT_A,
      organisationId: ORG_A,
      input: { expectedVersion: 1, displayName: "Acme Ltd", legalName: null },
    });
    await app.close();
  });
});

describe("POST /v1/organisations/:organisationId/activate", () => {
  it("activates without requiring the target to be the current context", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/organisations/${ORG_A}/activate`,
      payload: {
        tenantId: TENANT_A,
        membershipId: MEMBERSHIP_A,
        role: "admin",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ membership: { isActiveContext: boolean } }>().membership
        .isActiveContext,
    ).toBe(true);
    // The body is ignored entirely: only the path selector reaches the service.
    expect(calls.activate[0]).toMatchObject({
      principal: PRINCIPAL_A,
      organisationId: ORG_A,
    });
    expect(calls.activate[0]).not.toHaveProperty("tenantId");
    await app.close();
  });

  it("answers an inaccessible target with the enumeration-safe 403", async () => {
    const { service } = fakeService({
      activateOrganisation: () => Promise.reject(new ActorContextDeniedError()),
    });
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: `/v1/organisations/${ORG_B}/activate`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
    await app.close();
  });

  it("rejects a malformed organisation identifier", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL_A, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/organisations/not-a-uuid/activate",
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});
