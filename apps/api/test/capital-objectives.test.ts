import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  ActiveCapitalObjectiveExistsError,
  CapitalObjectiveCreationConflictError,
  CapitalObjectiveIdSchema,
  CapitalObjectiveLifecycleError,
  CapitalObjectiveNotFoundError,
  CapitalObjectiveVersionConflictError,
  type CapitalObjective,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema } from "@capital-q/companies";
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
 * HTTP adaptation of the capital objective routes over a recording double:
 * contract validation (identity, lifecycle, progress, readiness and
 * disclosure fields refused; exact money), DTO shape, cursor list and error
 * mapping. Behaviour is proven against the database in the capital package.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const OBJECTIVE = CapitalObjectiveIdSchema.parse(
  "f0000000-0000-4000-8000-000000000020",
);
const REPLACEMENT = CapitalObjectiveIdSchema.parse(
  "f0000000-0000-4000-8000-000000000021",
);
const KEY = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-03T09:00:00.000Z";
const TARGET = { amount: "4000000.10", currency: "USD" };

const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const ACTIVE: CapitalObjective = {
  id: OBJECTIVE,
  tenantId: TENANT,
  companyId: COMPANY,
  objectiveType: "RAISE",
  status: "ACTIVE",
  target: TARGET,
  targetStage: "series_a",
  instrumentCode: "safe",
  targetCloseDate: "2026-12-01",
  useOfFundsSummary: "Product and hiring.",
  startedAt: NOW,
  closedAt: null,
  createdByUserId: USER,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function fakeService(overrides: Partial<CapitalService> = {}) {
  const calls: Record<string, unknown[]> = {
    create: [],
    list: [],
    update: [],
    close: [],
    replace: [],
  };
  const service: CapitalService = {
    createCapitalObjective: (command) => {
      calls["create"]?.push(command);
      return Promise.resolve(ACTIVE);
    },
    getCurrentCapitalObjective: () => Promise.resolve(ACTIVE),
    getCapitalObjective: () => Promise.resolve(ACTIVE),
    listCapitalObjectives: (query) => {
      calls["list"]?.push(query);
      return Promise.resolve({ items: [ACTIVE], nextCursor: "abc" });
    },
    updateCapitalObjective: (command) => {
      calls["update"]?.push(command);
      return Promise.resolve({ ...ACTIVE, version: 2 });
    },
    closeCapitalObjective: (command) => {
      calls["close"]?.push(command);
      return Promise.resolve({
        ...ACTIVE,
        status: "ACHIEVED",
        closedAt: NOW,
        version: 2,
      });
    },
    replaceCapitalObjective: (command) => {
      calls["replace"]?.push(command);
      return Promise.resolve({
        replaced: { ...ACTIVE, status: "REPLACED", closedAt: NOW, version: 2 },
        replacement: { ...ACTIVE, id: REPLACEMENT },
      });
    },
    ...overrides,
  };
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: CapitalService;
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
    capital: options.service,
  }).app;
}

const BASE = `/v1/companies/${COMPANY}/capital-objectives`;

describe("POST /v1/companies/:id/capital-objectives", () => {
  it("requires a session, an organisation context and an Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const anonymous = buildApp({ principal: null, service });
    expect(
      (
        await anonymous.inject({
          method: "POST",
          url: BASE,
          headers: { "idempotency-key": KEY },
          payload: { target: TARGET },
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
          payload: { target: TARGET },
        })
      ).statusCode,
    ).toBe(400);
    await noContext.close();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    expect(
      (
        await app.inject({
          method: "POST",
          url: BASE,
          payload: { target: TARGET },
        })
      ).statusCode,
    ).toBe(422);
    await app.close();
    expect(calls["create"]).toHaveLength(0);
  });

  it("refuses authority, lifecycle, progress, readiness and disclosure fields and inexact money; accepts a typed objective", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      {},
      { target: { amount: 4000000, currency: "USD" } },
      { target: { amount: "0", currency: "USD" } },
      { target: { amount: "1", currency: "$" } },
      { target: TARGET, tenantId: TENANT },
      { target: TARGET, companyId: COMPANY },
      { target: TARGET, createdByUserId: USER },
      { target: TARGET, status: "ACHIEVED" },
      { target: TARGET, version: 2 },
      { target: TARGET, confirmedAmount: "1" },
      { target: TARGET, readinessScore: 0.5 },
      { target: TARGET, marketplaceVisibility: "network_visible" },
      { target: TARGET, targetCloseDate: "2026-12-01T00:00:00Z" },
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
        target: TARGET,
        targetStage: "series_a",
        instrumentCode: "safe",
        targetCloseDate: "2026-12-01",
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.headers["location"]).toBe(`${BASE}/${OBJECTIVE}`);
    const body = ok.json<Record<string, unknown>>();
    expect(body["status"]).toBe("ACTIVE");
    expect(body["target"]).toEqual(TARGET);
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("createdByUserId");
    expect(calls["create"]?.[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      idempotencyKey: KEY,
      input: {
        target: TARGET,
        targetStage: "series_a",
        instrumentCode: "safe",
      },
    });
    await app.close();
  });

  it("maps an existing active objective, key reuse and denial", async () => {
    for (const [error, status, code] of [
      [new ActiveCapitalObjectiveExistsError(), 409, "RESOURCE_CONFLICT"],
      [
        new CapitalObjectiveCreationConflictError(),
        409,
        "IDEMPOTENCY_CONFLICT",
      ],
      [
        new AuthorizationDeniedError("NO_MATCHING_GRANT"),
        403,
        "PERMISSION_DENIED",
      ],
      [new CapitalObjectiveNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
    ] as const) {
      const app = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service: fakeService({
          createCapitalObjective: () => Promise.reject(error),
        }).service,
      });
      const response = await app.inject({
        method: "POST",
        url: BASE,
        headers: { "idempotency-key": KEY },
        payload: { target: TARGET },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });
});

describe("GET current, by id and list", () => {
  it("reads DTOs with no-store, paginates with a cursor and rejects other filters", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const current = await app.inject({ method: "GET", url: `${BASE}/current` });
    expect(current.statusCode).toBe(200);
    expect(current.json<{ id: string }>().id).toBe(OBJECTIVE);
    expect(current.headers["cache-control"]).toBe("no-store");
    const byId = await app.inject({
      method: "GET",
      url: `${BASE}/${OBJECTIVE}`,
    });
    expect(byId.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: `${BASE}/not-a-uuid` }))
        .statusCode,
    ).toBe(422);
    const list = await app.inject({
      method: "GET",
      url: `${BASE}?limit=2&cursor=abc`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[]; nextCursor: string }>()).toMatchObject(
      {
        items: [{ id: OBJECTIVE }],
        nextCursor: "abc",
      },
    );
    expect(calls["list"]?.[0]).toMatchObject({ limit: 2, cursor: "abc" });
    expect(
      (await app.inject({ method: "GET", url: `${BASE}?status=ACTIVE` }))
        .statusCode,
    ).toBe(422);
    expect(
      (await app.inject({ method: "DELETE", url: `${BASE}/${OBJECTIVE}` }))
        .statusCode,
    ).toBe(404);
    await app.close();

    const missing = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        getCurrentCapitalObjective: () =>
          Promise.reject(new CapitalObjectiveNotFoundError()),
      }).service,
    });
    const response = await missing.inject({
      method: "GET",
      url: `${BASE}/current`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("RESOURCE_NOT_FOUND");
    await missing.close();
  });
});

describe("PATCH, close and replace", () => {
  it("requires expectedVersion and typed inputs; maps version and lifecycle conflicts", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { target: TARGET },
      { expectedVersion: 1 },
      { expectedVersion: 1, status: "ACHIEVED" },
      { expectedVersion: 1, target: { amount: 1, currency: "USD" } },
    ]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `${BASE}/${OBJECTIVE}`,
            payload,
          })
        ).statusCode,
        JSON.stringify(payload),
      ).toBe(422);
    }
    const ok = await app.inject({
      method: "PATCH",
      url: `${BASE}/${OBJECTIVE}`,
      payload: { expectedVersion: 1, target: TARGET, targetCloseDate: null },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ version: number }>().version).toBe(2);
    expect(calls["update"]?.[0]).toMatchObject({
      capitalObjectiveId: OBJECTIVE,
      input: { expectedVersion: 1, target: TARGET, targetCloseDate: null },
    });

    for (const payload of [
      {},
      { reason: "FAILED", expectedVersion: 1 },
      { reason: "REPLACED", expectedVersion: 1 },
      { reason: "ACHIEVED" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `${BASE}/${OBJECTIVE}/close`,
            payload,
          })
        ).statusCode,
        JSON.stringify(payload),
      ).toBe(422);
    }
    const closed = await app.inject({
      method: "POST",
      url: `${BASE}/${OBJECTIVE}/close`,
      payload: { reason: "ACHIEVED", expectedVersion: 1 },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ status: string }>().status).toBe("ACHIEVED");

    expect(
      (
        await app.inject({
          method: "POST",
          url: `${BASE}/${OBJECTIVE}/replace`,
          payload: {
            expectedVersion: 1,
            replacement: { target: TARGET, status: "ACTIVE" },
          },
        })
      ).statusCode,
    ).toBe(422);
    const replaced = await app.inject({
      method: "POST",
      url: `${BASE}/${OBJECTIVE}/replace`,
      payload: {
        expectedVersion: 1,
        replacement: { target: { amount: "6000000", currency: "USD" } },
      },
    });
    expect(replaced.statusCode).toBe(201);
    expect(replaced.headers["location"]).toBe(`${BASE}/${REPLACEMENT}`);
    expect(replaced.json<{ id: string; status: string }>()).toMatchObject({
      id: REPLACEMENT,
      status: "ACTIVE",
    });
    expect(calls["replace"]?.[0]).toMatchObject({
      capitalObjectiveId: OBJECTIVE,
      input: {
        expectedVersion: 1,
        replacement: { target: { amount: "6000000", currency: "USD" } },
      },
    });
    await app.close();

    for (const [error, code] of [
      [new CapitalObjectiveVersionConflictError(2), "VERSION_CONFLICT"],
      [
        new CapitalObjectiveLifecycleError("ACHIEVED", "closed"),
        "RESOURCE_CONFLICT",
      ],
    ] as const) {
      const conflicted = buildApp({
        principal: PRINCIPAL,
        context: CONTEXT,
        service: fakeService({
          updateCapitalObjective: () => Promise.reject(error),
        }).service,
      });
      const response = await conflicted.inject({
        method: "PATCH",
        url: `${BASE}/${OBJECTIVE}`,
        payload: { expectedVersion: 1, target: TARGET },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe(code);
      await conflicted.close();
    }
  });
});
