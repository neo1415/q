import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  InvestorCreationConflictError,
  InvestorOrganisationExistsError,
  InvestorOrganisationIdSchema,
  InvestorOrganisationNotFoundError,
  InvestorRepresentativeIdSchema,
  InvestorRepresentativeNotFoundError,
  InvestorVersionConflictError,
  type InvestorOrganisation,
  type InvestorRepresentative,
  type InvestorService,
} from "@capital-q/investors";
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
 * HTTP adaptation of the investor service: context hook (CONTEXT_REQUIRED
 * without an organisation), contract validation including refusal of
 * authority, verification, mandate and GateQ fields, and error mapping.
 * The service is a recording double; behaviour is proven against the
 * database in the investors package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const INVESTOR = InvestorOrganisationIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const KEY = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-03T09:00:00.000Z";

const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
};

const INVESTOR_A: InvestorOrganisation = {
  id: INVESTOR,
  tenantId: TENANT,
  organisationId: ORG,
  investorType: "VC",
  displayName: "Apex Ventures",
  websiteUrl: null,
  hqCountry: "GB",
  publicDescription: null,
  verificationState: "unverified",
  deploymentState: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const REPRESENTATIVE: InvestorRepresentative = {
  id: InvestorRepresentativeIdSchema.parse(
    "f0000000-0000-4000-8000-000000000002",
  ),
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  organisationId: ORG,
  userId: USER,
  membershipId: MEMBERSHIP,
  businessTitle: "Partner",
  isCurrent: true,
  startedAt: NOW,
  endedAt: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<InvestorService> = {}) {
  const calls: Record<string, unknown[]> = {
    create: [],
    update: [],
    upsert: [],
  };
  const service: InvestorService = {
    createInvestorOrganisation: (command) => {
      calls["create"]?.push(command);
      return Promise.resolve(INVESTOR_A);
    },
    getInvestorOrganisation: () => Promise.resolve(INVESTOR_A),
    getCurrentInvestorOrganisation: () => Promise.resolve(INVESTOR_A),
    updateInvestorOrganisation: (command) => {
      calls["update"]?.push(command);
      return Promise.resolve({
        ...INVESTOR_A,
        version: 2,
        deploymentState: "PAUSED",
      });
    },
    getMyInvestorRepresentative: () => Promise.resolve(REPRESENTATIVE),
    upsertMyInvestorRepresentative: (command) => {
      calls["upsert"]?.push(command);
      return Promise.resolve(REPRESENTATIVE);
    },
    // Mandate operations are covered by investor-mandates.test.ts.
    createInvestorMandate: notUnderTest,
    getInvestorMandate: notUnderTest,
    listInvestorMandates: notUnderTest,
    updateInvestorMandate: notUnderTest,
    activateInvestorMandate: notUnderTest,
    closeInvestorMandate: notUnderTest,
    listInvestorPortfolioReferences: notUnderTest,
    addInvestorPortfolioReference: notUnderTest,
    removeInvestorPortfolioReference: notUnderTest,
    ...overrides,
  };
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: InvestorService;
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
    investors: options.service,
  }).app;
}

const BASE = "/v1/investors";

describe("POST /v1/investors", () => {
  it("is 401 without a session, 400 CONTEXT_REQUIRED without an organisation, and calls nothing", async () => {
    const { service, calls } = fakeService();
    const anonymous = buildApp({ principal: null, service });
    expect(
      (
        await anonymous.inject({
          method: "POST",
          url: BASE,
          headers: { "idempotency-key": KEY },
          payload: { investorType: "VC" },
        })
      ).statusCode,
    ).toBe(401);
    await anonymous.close();
    const noContext = buildApp({ principal: PRINCIPAL, service });
    const response = await noContext.inject({
      method: "POST",
      url: BASE,
      headers: { "idempotency-key": KEY },
      payload: { investorType: "VC" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("INVALID_REQUEST");
    await noContext.close();
    expect(calls["create"]).toHaveLength(0);
  });

  it("requires an Idempotency-Key and a valid contract; refuses authority, verification and mandate fields", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const missingKey = await app.inject({
      method: "POST",
      url: BASE,
      payload: { investorType: "VC" },
    });
    expect(missingKey.statusCode).toBe(422);
    for (const payload of [
      { investorType: "HEDGE_FUND" },
      { investorType: "VC", tenantId: TENANT },
      { investorType: "VC", organisationId: ORG },
      { investorType: "VC", userId: USER },
      { investorType: "VC", membershipId: MEMBERSHIP },
      { investorType: "VC", verificationState: "PLATFORM_VERIFIED" },
      { investorType: "VC", isAdmin: true },
      { investorType: "VC", minCheque: "100000" },
      { investorType: "VC", inboundMode: "OPEN" },
      { investorType: "VC", deploymentState: "OPEN" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: BASE,
        headers: { "idempotency-key": KEY },
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(calls["create"]).toHaveLength(0);

    const ok = await app.inject({
      method: "POST",
      url: BASE,
      headers: { "idempotency-key": KEY },
      payload: { investorType: "VC", deploymentState: "ACTIVELY_INVESTING" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers["location"]).toBe(`${BASE}/${INVESTOR}`);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const body = ok.json<Record<string, unknown>>();
    expect(body["id"]).toBe(INVESTOR);
    expect(body["verificationState"]).toBe("unverified");
    expect(body["deploymentState"]).toBeNull();
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("organisationId");
    expect(calls["create"]?.[0]).toMatchObject({
      actor: CONTEXT,
      idempotencyKey: KEY,
      input: { investorType: "VC", deploymentState: "ACTIVELY_INVESTING" },
    });
    await app.close();
  });

  it("maps an already-established investor to 409 RESOURCE_CONFLICT and a key reuse to 409 IDEMPOTENCY_CONFLICT", async () => {
    for (const [error, code] of [
      [new InvestorOrganisationExistsError(), "RESOURCE_CONFLICT"],
      [new InvestorCreationConflictError(), "IDEMPOTENCY_CONFLICT"],
      [new AuthorizationDeniedError("NO_MATCHING_GRANT"), "PERMISSION_DENIED"],
    ] as const) {
      const app = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service: fakeService({
          createInvestorOrganisation: () => Promise.reject(error),
        }).service,
      });
      const response = await app.inject({
        method: "POST",
        url: BASE,
        headers: { "idempotency-key": KEY },
        payload: { investorType: "VC" },
      });
      expect(response.statusCode).toBe(
        code === "PERMISSION_DENIED" ? 403 : 409,
      );
      expect(response.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });
});

describe("GET /v1/investors/current and /:id", () => {
  it("reads the DTO with no-store and maps not-found enumeration-safely", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const current = await app.inject({ method: "GET", url: `${BASE}/current` });
    expect(current.statusCode).toBe(200);
    expect(current.json<{ id: string }>().id).toBe(INVESTOR);
    expect(current.headers["cache-control"]).toBe("no-store");
    const byId = await app.inject({
      method: "GET",
      url: `${BASE}/${INVESTOR}`,
    });
    expect(byId.statusCode).toBe(200);
    const malformed = await app.inject({
      method: "GET",
      url: `${BASE}/not-a-uuid`,
    });
    expect(malformed.statusCode).toBe(422);
    await app.close();

    const missing = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        getInvestorOrganisation: () =>
          Promise.reject(new InvestorOrganisationNotFoundError()),
        getCurrentInvestorOrganisation: () =>
          Promise.reject(new InvestorOrganisationNotFoundError()),
      }).service,
    });
    for (const url of [`${BASE}/current`, `${BASE}/${INVESTOR}`]) {
      const response = await missing.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ code: string }>().code).toBe("RESOURCE_NOT_FOUND");
    }
    await missing.close();
  });
});

describe("PATCH /v1/investors/:id", () => {
  it("requires expectedVersion, refuses verification, mandate and GateQ fields, and maps version conflicts", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { deploymentState: "PAUSED" },
      { expectedVersion: 1 },
      { expectedVersion: 1, verificationState: "PLATFORM_VERIFIED" },
      { expectedVersion: 1, minCheque: "100000" },
      { expectedVersion: 1, maxCheque: "1000000" },
      { expectedVersion: 1, sector: "fintech" },
      { expectedVersion: 1, stage: "seed" },
      { expectedVersion: 1, discoveryMode: "broad" },
      { expectedVersion: 1, hardExclusions: ["gambling"] },
      { expectedVersion: 1, inboundMode: "OPEN" },
      { expectedVersion: 1, tenantId: TENANT },
      { expectedVersion: 1, organisationId: ORG },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: `${BASE}/${INVESTOR}`,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(calls["update"]).toHaveLength(0);

    const ok = await app.inject({
      method: "PATCH",
      url: `${BASE}/${INVESTOR}`,
      payload: { expectedVersion: 1, deploymentState: "PAUSED" },
    });
    expect(ok.statusCode).toBe(200);
    expect(
      ok.json<{ version: number; deploymentState: string }>(),
    ).toMatchObject({ version: 2, deploymentState: "PAUSED" });
    expect(calls["update"]?.[0]).toMatchObject({
      actor: CONTEXT,
      investorOrganisationId: INVESTOR,
      input: { expectedVersion: 1, deploymentState: "PAUSED" },
    });
    await app.close();

    const stale = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        updateInvestorOrganisation: () =>
          Promise.reject(new InvestorVersionConflictError(2)),
      }).service,
    });
    const response = await stale.inject({
      method: "PATCH",
      url: `${BASE}/${INVESTOR}`,
      payload: { expectedVersion: 1, deploymentState: "PAUSED" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("VERSION_CONFLICT");
    await stale.close();
  });
});

describe("/v1/investors/:id/representatives/me", () => {
  it("links the caller only: no userId or membershipId is accepted; the DTO carries no person or membership", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { userId: USER },
      { membershipId: MEMBERSHIP },
      { isCurrent: false },
      { role: "organisation_admin" },
      { businessTitle: "x".repeat(121) },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: `${BASE}/${INVESTOR}/representatives/me`,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(calls["upsert"]).toHaveLength(0);

    const ok = await app.inject({
      method: "PUT",
      url: `${BASE}/${INVESTOR}/representatives/me`,
      payload: { businessTitle: "Partner" },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<Record<string, unknown>>();
    expect(body["businessTitle"]).toBe("Partner");
    expect(body["investorOrganisationId"]).toBe(INVESTOR);
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("membershipId");
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("organisationId");
    expect(calls["upsert"]?.[0]).toMatchObject({
      actor: CONTEXT,
      investorOrganisationId: INVESTOR,
      input: { businessTitle: "Partner" },
    });
    const get = await app.inject({
      method: "GET",
      url: `${BASE}/${INVESTOR}/representatives/me`,
    });
    expect(get.statusCode).toBe(200);
    await app.close();

    const none = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        getMyInvestorRepresentative: () =>
          Promise.reject(new InvestorRepresentativeNotFoundError()),
      }).service,
    });
    const response = await none.inject({
      method: "GET",
      url: `${BASE}/${INVESTOR}/representatives/me`,
    });
    expect(response.statusCode).toBe(404);
    await none.close();
  });
});
