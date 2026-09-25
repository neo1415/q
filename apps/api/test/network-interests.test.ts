import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { UtcTimestampSchema } from "@capital-q/contracts";
import {
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestIdSchema,
  InterestNotPermittedError,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type ExpressInterestCommand,
  type Interest,
  type InterestService,
} from "@capital-q/network";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  AuthUserIdSchema,
  AuthorizationDeniedError,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/network/companies/:companyId/…` over HTTP (CQ-NET-010).
 *
 * The handler is thin; what is worth testing is the trust boundary. The
 * key is required, the body cannot name an organisation, tenant or
 * relationship, the actor reaching the service is the server-resolved one,
 * and each refusal has its own stable problem code.
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
const COMPANY = "44444444-0000-4000-8000-000000000001";
const PATH = `/v1/network/companies/${COMPANY}/express-interest`;
const KEY = "interest:0f6c1e7a-1111-4111-8111-000000000001";

const INTEREST: Interest = {
  id: InterestIdSchema.parse("77777777-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("22222222-0000-4000-8000-000000000001"),
  relationshipId: RelationshipIdSchema.parse(
    "88888888-0000-4000-8000-000000000001",
  ),
  companyId: CompanyIdSchema.parse(COMPANY),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  expressedByParty: "INVESTOR",
  status: "EXPRESSED",
  expressedByUserId: CONTEXT.userId,
  expressedInOrganisationId: "d0000000-0000-4000-8000-000000000001",
  relationshipEventId: RelationshipEventIdSchema.parse(
    "99999999-0000-4000-8000-000000000001",
  ),
  createdAt: UtcTimestampSchema.parse("2026-09-24T10:00:00.000Z"),
};

function buildApp(
  options: {
    readonly failWith?: Error | undefined;
    readonly deduplicated?: boolean | undefined;
  } = {},
): { readonly app: FastifyInstance; readonly calls: ExpressInterestCommand[] } {
  const calls: ExpressInterestCommand[] = [];
  const interests: InterestService = {
    expressInterest: (command) => {
      calls.push(command);
      return options.failWith === undefined
        ? Promise.resolve({
            interest: INTEREST,
            deduplicated: options.deduplicated ?? false,
          })
        : Promise.reject(options.failWith);
    },
    getOwnInterest: () =>
      options.failWith === undefined
        ? Promise.resolve(INTEREST)
        : Promise.reject(options.failWith),
    mayExpressInterest: () => Promise.resolve(options.failWith === undefined),
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    interests,
  });
  return { app, calls };
}

const post = (
  app: FastifyInstance,
  payload: unknown,
  headers: Record<string, string> = { "idempotency-key": KEY },
) =>
  app.inject({
    method: "POST",
    url: PATH,
    payload: payload as object,
    headers,
  });

describe("POST /v1/network/companies/:companyId/express-interest", () => {
  it("expresses interest as the server-resolved actor and answers 201 with the interest", async () => {
    const { app, calls } = buildApp();
    const response = await post(app, { surface: "RECOMMENDATION_FEED" });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      interest: {
        interestId: INTEREST.id,
        relationshipId: INTEREST.relationshipId,
        companyId: COMPANY,
        status: "EXPRESSED",
        expressedAt: INTEREST.createdAt,
      },
      deduplicated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      surface: "RECOMMENDATION_FEED",
      idempotencyKey: KEY,
    });
  });

  it("answers 200 and deduplicated when nothing new was written", async () => {
    const { app } = buildApp({ deduplicated: true });
    const response = await post(app, { surface: "COMPANY_PROFILE" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deduplicated: true });
  });

  it("requires an Idempotency-Key", async () => {
    const { app, calls } = buildApp();
    const response = await post(app, { surface: "RECOMMENDATION_FEED" }, {});
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(calls).toHaveLength(0);
  });

  it("accepts no organisation, tenant or relationship in the body", async () => {
    const { app, calls } = buildApp();
    for (const extra of [
      { investorOrganisationId: "11111111-0000-4000-8000-000000000099" },
      { tenantId: "c0000000-0000-4000-8000-000000000099" },
      { relationshipId: "88888888-0000-4000-8000-000000000099" },
      { surface: "Q_CONVERSATION" },
    ]) {
      const response = await post(app, {
        surface: "RECOMMENDATION_FEED",
        ...extra,
      });
      expect(response.statusCode).toBe(422);
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    [new InterestCompanyNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
    [new InterestNotPermittedError(), 403, "PERMISSION_DENIED"],
    [
      new AuthorizationDeniedError("NO_MATCHING_GRANT"),
      403,
      "PERMISSION_DENIED",
    ],
    [new InterestIdempotencyConflictError(), 409, "IDEMPOTENCY_CONFLICT"],
  ] as const)("maps %s to a stable problem", async (error, status, code) => {
    const { app } = buildApp({ failWith: error });
    const response = await post(app, { surface: "RECOMMENDATION_FEED" });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
  });
});

describe("GET /v1/network/companies/:companyId/interest", () => {
  it("returns the caller's organisation's own interest", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/interest`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      interest: { interestId: INTEREST.id, status: "EXPRESSED" },
    });
  });

  it("answers not-found for a company the caller may not see", async () => {
    const { app } = buildApp({ failWith: new InterestCompanyNotFoundError() });
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/interest`,
    });
    expect(response.statusCode).toBe(404);
  });
});
