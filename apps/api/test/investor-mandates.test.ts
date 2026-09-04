import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  InvestorMandateCreationConflictError,
  InvestorMandateIdSchema,
  InvestorMandateLifecycleError,
  InvestorMandateNotFoundError,
  InvestorOrganisationIdSchema,
  InvestorVersionConflictError,
  type InvestorMandate,
  type InvestorMandateSummary,
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
 * HTTP adaptation of the mandate routes over a recording double: contract
 * validation (identity, lifecycle, behaviour, GateQ and protected
 * dimensions refused), DTO shape, cursor list and error mapping. Behaviour
 * is proven against the database in the investors package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const INVESTOR = InvestorOrganisationIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const MANDATE = InvestorMandateIdSchema.parse(
  "f0000000-0000-4000-8000-000000000010",
);
const KEY = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-03T09:00:00.000Z";

const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const DRAFT: InvestorMandate = {
  id: MANDATE,
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  name: "Primary Seed Mandate",
  status: "DRAFT",
  effectiveFrom: null,
  effectiveTo: null,
  discoveryMode: "STRICT",
  minCheque: "250000",
  maxCheque: "2000000",
  currencyCode: "USD",
  minStageCode: null,
  maxStageCode: null,
  rawMandateText: "We back technical founders.",
  createdByUserId: USER,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  constraints: [],
  taxonomyPreferences: [],
};
const SUMMARY: InvestorMandateSummary = {
  id: MANDATE,
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  name: DRAFT.name,
  status: "DRAFT",
  discoveryMode: "STRICT",
  effectiveFrom: null,
  effectiveTo: null,
  version: 1,
  createdAt: NOW,
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<InvestorService> = {}) {
  const calls: Record<string, unknown[]> = {
    create: [],
    list: [],
    update: [],
    activate: [],
    close: [],
  };
  const service: InvestorService = {
    createInvestorOrganisation: notUnderTest,
    getInvestorOrganisation: notUnderTest,
    getCurrentInvestorOrganisation: notUnderTest,
    updateInvestorOrganisation: notUnderTest,
    getMyInvestorRepresentative: notUnderTest,
    upsertMyInvestorRepresentative: notUnderTest,
    createInvestorMandate: (command) => {
      calls["create"]?.push(command);
      return Promise.resolve(DRAFT);
    },
    getInvestorMandate: () => Promise.resolve(DRAFT),
    listInvestorMandates: (query) => {
      calls["list"]?.push(query);
      return Promise.resolve({ items: [SUMMARY], nextCursor: "abc" });
    },
    updateInvestorMandate: (command) => {
      calls["update"]?.push(command);
      return Promise.resolve({
        ...DRAFT,
        version: 2,
        discoveryMode: "BALANCED",
      });
    },
    activateInvestorMandate: (command) => {
      calls["activate"]?.push(command);
      return Promise.resolve({
        ...DRAFT,
        status: "ACTIVE",
        effectiveFrom: NOW,
        version: 2,
      });
    },
    closeInvestorMandate: (command) => {
      calls["close"]?.push(command);
      return Promise.resolve({
        ...DRAFT,
        status: "CLOSED",
        effectiveFrom: NOW,
        effectiveTo: NOW,
        version: 3,
      });
    },
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

const BASE = `/v1/investors/${INVESTOR}/mandates`;
const STAGE = {
  dimension: "stage",
  operator: "IN",
  value: { kind: "codes", values: ["seed"] },
  importance: "MUST",
  isHardExclusion: false,
};

describe("POST /v1/investors/:id/mandates", () => {
  it("requires a session, an organisation context and an Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const anonymous = buildApp({ principal: null, service });
    expect(
      (
        await anonymous.inject({
          method: "POST",
          url: BASE,
          headers: { "idempotency-key": KEY },
          payload: { name: "x" },
        })
      ).statusCode,
    ).toBe(401);
    await anonymous.close();
    const noContext = buildApp({ principal: PRINCIPAL, service });
    expect(
      (
        await noContext.inject({
          method: "POST",
          url: BASE,
          headers: { "idempotency-key": KEY },
          payload: { name: "x" },
        })
      ).statusCode,
    ).toBe(400);
    await noContext.close();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    expect(
      (await app.inject({ method: "POST", url: BASE, payload: { name: "x" } }))
        .statusCode,
    ).toBe(422);
    await app.close();
    expect(calls["create"]).toHaveLength(0);
  });

  it("refuses identity, lifecycle, behaviour, GateQ, protected and executable inputs; accepts a typed draft", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { name: "x", tenantId: TENANT },
      { name: "x", investorOrganisationId: INVESTOR },
      { name: "x", createdByUserId: USER },
      { name: "x", status: "ACTIVE" },
      { name: "x", effectiveFrom: NOW },
      { name: "x", observedBehaviour: {} },
      { name: "x", gateqMode: "OPEN" },
      { name: "x", chequeRange: { currency: "USD", min: 250000 } },
      { name: "x", chequeRange: { currency: "USD", min: "-1" } },
      { name: "x", constraints: [{ ...STAGE, dimension: "religion" }] },
      {
        name: "x",
        constraints: [{ ...STAGE, operator: "SQL", value: "DROP TABLE x" }],
      },
      {
        name: "x",
        constraints: [{ ...STAGE, importance: "NICE", isHardExclusion: true }],
      },
      { name: "x", constraints: [{ ...STAGE, importance: "HIGH" }] },
      { name: "x", constraints: [{ ...STAGE, dimension: "cheque.typical" }] },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: BASE,
        headers: { "idempotency-key": KEY },
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
      expect(response.json<{ code: string }>().code).toBe("VALIDATION_FAILED");
    }
    expect(calls["create"]).toHaveLength(0);

    const ok = await app.inject({
      method: "POST",
      url: BASE,
      headers: { "idempotency-key": KEY },
      payload: {
        name: "Primary Seed Mandate",
        discoveryMode: "STRICT",
        chequeRange: { currency: "USD", min: "250000", max: "2000000" },
        constraints: [STAGE],
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers["location"]).toBe(`${BASE}/${MANDATE}`);
    const body = ok.json<Record<string, unknown>>();
    expect(body["status"]).toBe("DRAFT");
    expect(body["chequeRange"]).toEqual({
      currency: "USD",
      min: "250000",
      max: "2000000",
    });
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("createdByUserId");
    expect(calls["create"]?.[0]).toMatchObject({
      actor: CONTEXT,
      investorOrganisationId: INVESTOR,
      idempotencyKey: KEY,
      input: { name: "Primary Seed Mandate", discoveryMode: "STRICT" },
    });
    await app.close();
  });

  it("maps idempotency conflicts and denials", async () => {
    for (const [error, status, code] of [
      [new InvestorMandateCreationConflictError(), 409, "IDEMPOTENCY_CONFLICT"],
      [
        new AuthorizationDeniedError("NO_MATCHING_GRANT"),
        403,
        "PERMISSION_DENIED",
      ],
    ] as const) {
      const app = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service: fakeService({
          createInvestorMandate: () => Promise.reject(error),
        }).service,
      });
      const response = await app.inject({
        method: "POST",
        url: BASE,
        headers: { "idempotency-key": KEY },
        payload: { name: "x" },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });
});

describe("GET list and by id", () => {
  it("lists with cursor, limit and status; rejects other filters; maps not-found", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const list = await app.inject({
      method: "GET",
      url: `${BASE}?limit=2&status=DRAFT&cursor=abc`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[]; nextCursor: string }>()).toMatchObject(
      {
        items: [{ id: MANDATE, status: "DRAFT" }],
        nextCursor: "abc",
      },
    );
    expect(calls["list"]?.[0]).toMatchObject({
      limit: 2,
      status: "DRAFT",
      cursor: "abc",
    });
    expect(
      (await app.inject({ method: "GET", url: `${BASE}?sector=fintech` }))
        .statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: "GET", url: `${BASE}?status=OPEN` }))
        .statusCode,
    ).toBe(422);
    const one = await app.inject({ method: "GET", url: `${BASE}/${MANDATE}` });
    expect(one.statusCode).toBe(200);
    expect(one.headers["cache-control"]).toBe("no-store");
    await app.close();

    const missing = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        getInvestorMandate: () =>
          Promise.reject(new InvestorMandateNotFoundError()),
      }).service,
    });
    const response = await missing.inject({
      method: "GET",
      url: `${BASE}/${MANDATE}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("RESOURCE_NOT_FOUND");
    await missing.close();
  });
});

describe("PATCH, activate and close", () => {
  it("requires expectedVersion, forwards typed changes, and maps version and lifecycle conflicts", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { discoveryMode: "BALANCED" },
      { expectedVersion: 1 },
      { expectedVersion: 1, status: "CLOSED" },
      { expectedVersion: 1, constraints: "seed" },
    ]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `${BASE}/${MANDATE}`,
            payload,
          })
        ).statusCode,
        JSON.stringify(payload),
      ).toBe(422);
    }
    const ok = await app.inject({
      method: "PATCH",
      url: `${BASE}/${MANDATE}`,
      payload: {
        expectedVersion: 1,
        discoveryMode: "BALANCED",
        constraints: [STAGE],
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ version: number }>().version).toBe(2);
    expect(calls["update"]?.[0]).toMatchObject({
      mandateId: MANDATE,
      input: { expectedVersion: 1, discoveryMode: "BALANCED" },
    });

    const activate = await app.inject({
      method: "POST",
      url: `${BASE}/${MANDATE}/activate`,
      payload: { expectedVersion: 1 },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json<{ status: string }>().status).toBe("ACTIVE");
    const close = await app.inject({
      method: "POST",
      url: `${BASE}/${MANDATE}/close`,
    });
    expect(close.statusCode).toBe(200);
    expect(close.json<{ status: string }>().status).toBe("CLOSED");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${BASE}/${MANDATE}/activate`,
          payload: { force: true },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: "DELETE", url: `${BASE}/${MANDATE}` }))
        .statusCode,
    ).toBe(404);
    await app.close();

    for (const [error, code] of [
      [new InvestorVersionConflictError(2, "mandate"), "VERSION_CONFLICT"],
      [
        new InvestorMandateLifecycleError("CLOSED", "closed"),
        "RESOURCE_CONFLICT",
      ],
    ] as const) {
      const conflicted = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service: fakeService({
          updateInvestorMandate: () => Promise.reject(error),
        }).service,
      });
      const response = await conflicted.inject({
        method: "PATCH",
        url: `${BASE}/${MANDATE}`,
        payload: { expectedVersion: 1, name: "x" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe(code);
      await conflicted.close();
    }
  });
});
