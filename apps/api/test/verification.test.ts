import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { CompanyNotFoundError } from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
import {
  CompanyVerificationDtoSchema,
  type CompanyVerificationDto,
} from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type {
  CompanyVerificationService,
  RequestCompanyVerificationCommand,
} from "@capital-q/verification";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/companies/:companyId/verification` at the HTTP boundary. The
 * service is a recording double; what a claim may become is proven against
 * the database in the Verification package. Proven here: no request can
 * name a standing, the key is required, and nothing leaves but the DTO.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
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
const COMPANY = "aa000000-0000-4000-8000-000000000001";
const KEY = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-24T09:00:00.000Z";

function standing(
  claimType: "FOUNDER_IDENTITY" | "ORGANISATION",
  status: "NOT_REQUESTED" | "PENDING",
) {
  return {
    claimType,
    subjectType: claimType === "FOUNDER_IDENTITY" ? "PERSON" : "ORGANISATION",
    status,
    method: null,
    requestedAt: status === "PENDING" ? NOW : null,
    decidedAt: null,
    verifiedAt: null,
    expiresAt: null,
    revokedAt: null,
    description: "Requested; Capital Q has not decided yet.",
  } as const;
}

function view(status: "NOT_REQUESTED" | "PENDING"): CompanyVerificationDto {
  return CompanyVerificationDtoSchema.parse({
    companyId: COMPANY,
    standings: [
      standing("FOUNDER_IDENTITY", status),
      standing("ORGANISATION", status),
    ],
    requestable: status === "NOT_REQUESTED",
    retrievedAt: NOW,
  });
}

function fakeService(overrides: Partial<CompanyVerificationService> = {}) {
  const requests: RequestCompanyVerificationCommand[] = [];
  let pending = false;
  const service: CompanyVerificationService = {
    getCompanyVerification: () =>
      Promise.resolve(view(pending ? "PENDING" : "NOT_REQUESTED")),
    requestCompanyVerification: (command) => {
      requests.push(command);
      const requested = pending
        ? []
        : (["FOUNDER_IDENTITY", "ORGANISATION"] as const);
      pending = true;
      return Promise.resolve({
        verification: view("PENDING"),
        requested: [...requested],
      });
    },
    ...overrides,
  };
  return { service, requests };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly service: CompanyVerificationService;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    verification: options.service,
  }).app;
}

const readUrl = `/v1/companies/${COMPANY}/verification`;
const requestUrl = `/v1/companies/${COMPANY}/verification/requests`;

describe("verification routes", () => {
  it("refuses an unauthenticated caller", async () => {
    const { service, requests } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: { "idempotency-key": KEY },
    });
    expect(response.statusCode).toBe(401);
    expect(requests).toHaveLength(0);
    await app.close();
  });

  it("reads the two standings, uncached", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({ method: "GET", url: readUrl });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<CompanyVerificationDto>();
    expect(body.standings.map((s) => s.status)).toEqual([
      "NOT_REQUESTED",
      "NOT_REQUESTED",
    ]);
    await app.close();
  });

  it("requires an Idempotency-Key", async () => {
    const { service, requests } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({ method: "POST", url: requestUrl });
    expect(response.statusCode).toBe(422);
    expect(requests).toHaveLength(0);
    await app.close();
  });

  it.each([
    ["a status", { status: "VERIFIED" }],
    ["a method", { method: "OPERATOR_DECISION" }],
    ["a claim type", { claimType: "FOUNDER_IDENTITY" }],
    ["tenancy", { tenantId: "c0000000-0000-4000-8000-000000000009" }],
  ])("refuses a body that names %s", async (_label, payload) => {
    const { service, requests } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: { "idempotency-key": KEY },
      payload,
    });
    expect(response.statusCode).toBe(422);
    expect(requests).toHaveLength(0);
    await app.close();
  });

  it("accepts a new request with 202 and a replay with 200, passing the actor and key", async () => {
    const { service, requests } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const first = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: { "idempotency-key": KEY },
    });
    expect(first.statusCode).toBe(202);
    expect(
      first.json<CompanyVerificationDto>().standings.map((s) => s.status),
    ).toEqual(["PENDING", "PENDING"]);
    const replay = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: { "idempotency-key": KEY },
    });
    expect(replay.statusCode).toBe(200);
    expect(requests[0]?.actor).toEqual(CONTEXT);
    expect(requests[0]?.companyId).toBe(COMPANY);
    expect(requests[0]?.idempotencyKey).toBe(KEY);
    await app.close();
  });

  it("answers another organisation's company as not found", async () => {
    const { service } = fakeService({
      getCompanyVerification: () => Promise.reject(new CompanyNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({ method: "GET", url: readUrl });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
