import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  CompanyCreationConflictError,
  CompanyIdSchema,
  CompanyNotFoundError,
  CompanyVersionConflictError,
  type Company,
  type CompanyService,
} from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
import {
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
 * HTTP adaptation of the company service: context hook (CONTEXT_REQUIRED
 * without an organisation), contract validation including refusal of
 * authority and marketplace fields, and error mapping. The service is a
 * recording double; behaviour is proven against the database in the
 * companies package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const KEY = "11111111-2222-4333-8444-555555555555";

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const COMPANY_A: Company = {
  id: COMPANY,
  tenantId: TENANT,
  organisationId: ORG,
  canonicalName: "Acme",
  legalName: null,
  slug: "acme",
  websiteUrl: null,
  foundedDate: null,
  headquartersCountry: null,
  headquartersCity: null,
  currentStageCode: null,
  primaryDescription: null,
  shortDescription: null,
  companyStatus: "active",
  marketplaceVisibility: "organisation_private",
  marketplaceReadinessState: "not_assessed",
  logoStorageKey: null,
  version: 1,
  createdAt: "2026-09-03T09:00:00.000Z",
  updatedAt: "2026-09-03T09:00:00.000Z",
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<CompanyService> = {}) {
  const calls: { create: unknown[]; update: unknown[] } = {
    create: [],
    update: [],
  };
  const service: CompanyService = {
    createCompany: (command) => {
      calls.create.push(command);
      return Promise.resolve(COMPANY_A);
    },
    getCompany: () => Promise.resolve(COMPANY_A),
    updateCompany: (command) => {
      calls.update.push(command);
      return Promise.resolve({ ...COMPANY_A, version: 2 });
    },
    // Founder / team operations are covered by company-team.test.ts.
    getMyCompanyMembership: notUnderTest,
    upsertMyCompanyMembership: notUnderTest,
    getMyFounderProfile: notUnderTest,
    updateMyFounderProfile: notUnderTest,
    getCompanyTeamFacts: notUnderTest,
    updateCompanyTeamFacts: notUnderTest,
    ...overrides,
  };
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: CompanyService;
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
    companies: options.service,
  }).app;
}

describe("POST /v1/companies", () => {
  it("is 401 without a session and calls nothing", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies",
      headers: { "idempotency-key": KEY },
      payload: { canonicalName: "Acme" },
    });
    expect(response.statusCode).toBe(401);
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it("is CONTEXT_REQUIRED (400 INVALID_REQUEST) for a person with no active organisation", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies",
      headers: { "idempotency-key": KEY },
      payload: { canonicalName: "Acme" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string; detail: string }>().detail).toMatch(
      /organisation context/,
    );
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it("requires an Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies",
      payload: { canonicalName: "Acme" },
    });
    expect(response.statusCode).toBe(422);
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it.each([
    ["tenantId", { tenantId: TENANT }],
    ["organisationId", { organisationId: ORG }],
    ["companyId", { companyId: COMPANY }],
    ["companyStatus", { companyStatus: "active" }],
    ["marketplaceVisibility", { marketplaceVisibility: "network_visible" }],
    ["marketplaceReadinessState", { marketplaceReadinessState: "ready" }],
    ["verified", { verified: true }],
    ["score", { score: 0.9 }],
    ["fit", { fit: "high" }],
    ["createdBy", { createdBy: "b0000000-0000-4000-8000-000000000001" }],
  ])("refuses the authority field %s by contract", async (_, extra) => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies",
      headers: { "idempotency-key": KEY },
      payload: { canonicalName: "Acme", ...extra },
    });
    expect(response.statusCode).toBe(422);
    expect(calls.create).toHaveLength(0);
    await app.close();
  });

  it("creates with 201, Location and a DTO without tenant, organisation or logo key", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies",
      headers: { "idempotency-key": KEY },
      payload: {
        canonicalName: "Acme",
        headquartersCountry: "GB",
        foundedDate: "2021-03-15",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["location"]).toBe(`/v1/companies/${COMPANY}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<Record<string, unknown>>();
    expect(body["id"]).toBe(COMPANY);
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("organisationId");
    expect(body).not.toHaveProperty("logoStorageKey");
    expect(body["marketplaceVisibility"]).toBe("organisation_private");
    expect(calls.create[0]).toMatchObject({
      actor: CONTEXT,
      idempotencyKey: KEY,
      input: {
        canonicalName: "Acme",
        headquartersCountry: "GB",
        foundedDate: "2021-03-15",
      },
    });
    await app.close();
  });

  it("maps denial and idempotency conflict", async () => {
    for (const [error, status, code] of [
      [
        new AuthorizationDeniedError("NO_MATCHING_GRANT"),
        403,
        "PERMISSION_DENIED",
      ],
      [new CompanyCreationConflictError(), 409, "IDEMPOTENCY_CONFLICT"],
    ] as const) {
      const { service } = fakeService({
        createCompany: () => Promise.reject(error),
      });
      const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
      const response = await app.inject({
        method: "POST",
        url: "/v1/companies",
        headers: { "idempotency-key": KEY },
        payload: { canonicalName: "Acme" },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });
});

describe("GET/PATCH /v1/companies/:companyId", () => {
  it("reads the DTO for the current context", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/companies/${COMPANY}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ id: string; version: number }>()).toMatchObject({
      id: COMPANY,
      version: 1,
    });
    await app.close();
  });

  it("maps not-found and version conflict without leaking detail", async () => {
    for (const [error, status, code] of [
      [new CompanyNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
      [new CompanyVersionConflictError(2), 409, "VERSION_CONFLICT"],
    ] as const) {
      const { service } = fakeService({
        getCompany: () => Promise.reject(error),
        updateCompany: () => Promise.reject(error),
      });
      const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
      const get = await app.inject({
        method: "GET",
        url: `/v1/companies/${COMPANY}`,
      });
      expect(get.statusCode).toBe(status);
      expect(get.body).not.toContain("Acme");
      const patch = await app.inject({
        method: "PATCH",
        url: `/v1/companies/${COMPANY}`,
        payload: { expectedVersion: 1, shortDescription: "x" },
      });
      expect(patch.statusCode).toBe(status);
      expect(patch.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });

  it.each([
    ["no expectedVersion", { shortDescription: "x" }],
    ["no editable field", { expectedVersion: 1 }],
    ["id", { expectedVersion: 1, id: COMPANY }],
    ["tenantId", { expectedVersion: 1, tenantId: TENANT }],
    ["organisationId", { expectedVersion: 1, organisationId: ORG }],
    ["slug", { expectedVersion: 1, slug: "x" }],
    ["companyStatus", { expectedVersion: 1, companyStatus: "closed" }],
    [
      "marketplaceVisibility",
      { expectedVersion: 1, marketplaceVisibility: "public_external" },
    ],
    [
      "marketplaceReadinessState",
      { expectedVersion: 1, marketplaceReadinessState: "ready" },
    ],
    ["logoStorageKey", { expectedVersion: 1, logoStorageKey: "x" }],
  ])("refuses an update with %s", async (_, payload) => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/companies/${COMPANY}`,
      payload,
    });
    expect(response.statusCode).toBe(422);
    expect(calls.update).toHaveLength(0);
    await app.close();
  });

  it("passes a valid update through and returns the new version", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/companies/${COMPANY}`,
      payload: {
        expectedVersion: 1,
        shortDescription: "Rail intelligence.",
        currentStageCode: "seed",
        legalName: null,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ version: number }>().version).toBe(2);
    expect(calls.update[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      input: {
        expectedVersion: 1,
        shortDescription: "Rail intelligence.",
        currentStageCode: "seed",
        legalName: null,
      },
    });
    await app.close();
  });

  it("rejects a malformed company identifier", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: "/v1/companies/not-a-uuid",
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});
