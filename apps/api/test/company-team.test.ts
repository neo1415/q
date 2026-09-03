import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  CompanyIdSchema,
  CompanyMemberIdSchema,
  FounderProfileIdSchema,
  FounderProfileNotAllowedError,
  TeamVersionConflictError,
  type CompanyMember,
  type CompanyService,
  type CompanyTeamFacts,
  type FounderProfile,
} from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/** HTTP adaptation of the founder / team routes over a recording double. */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const NOW = "2026-09-03T09:00:00.000Z";

const MEMBER: CompanyMember = {
  id: CompanyMemberIdSchema.parse("e0000000-0000-4000-8000-0000000000aa"),
  tenantId: TENANT,
  companyId: COMPANY,
  userId: USER,
  relationshipType: "team_member",
  businessTitle: "CEO",
  isFounder: true,
  isCurrent: true,
  startedAt: NOW,
  endedAt: null,
  version: 1,
};
const PROFILE: FounderProfile = {
  id: FounderProfileIdSchema.parse("e0000000-0000-4000-8000-0000000000bb"),
  tenantId: TENANT,
  userId: USER,
  primaryCompanyId: COMPANY,
  professionalSummary: "Rail engineer",
  backgroundSummary: null,
  visibilityScope: "founder_private",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const FACTS: CompanyTeamFacts = {
  tenantId: TENANT,
  companyId: COMPANY,
  founderCount: 3,
  fullTimeFounderCount: 2,
  teamSize: 11,
  version: 1,
  updatedAt: NOW,
};

const unused = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<CompanyService> = {}) {
  const calls: Record<string, unknown[]> = {
    upsert: [],
    profile: [],
    facts: [],
  };
  const service: CompanyService = {
    createCompany: unused,
    getCompany: unused,
    updateCompany: unused,
    getMyCompanyMembership: () => Promise.resolve(MEMBER),
    upsertMyCompanyMembership: (command) => {
      calls["upsert"]?.push(command);
      return Promise.resolve(MEMBER);
    },
    getMyFounderProfile: () => Promise.resolve(PROFILE),
    updateMyFounderProfile: (command) => {
      calls["profile"]?.push(command);
      return Promise.resolve({ ...PROFILE, version: 2 });
    },
    getCompanyTeamFacts: () => Promise.resolve(FACTS),
    updateCompanyTeamFacts: (command) => {
      calls["facts"]?.push(command);
      return Promise.resolve({ ...FACTS, version: 2 });
    },
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

const BASE = `/v1/companies/${COMPANY}`;

describe("team/me", () => {
  it("requires a session and an organisation context", async () => {
    const { service, calls } = fakeService();
    const anonymous = buildApp({ principal: null, service });
    expect(
      (
        await anonymous.inject({
          method: "PUT",
          url: `${BASE}/team/me`,
          payload: { relationshipType: "team_member", isFounder: true },
        })
      ).statusCode,
    ).toBe(401);
    await anonymous.close();
    const noContext = buildApp({ principal: PRINCIPAL, service });
    expect(
      (
        await noContext.inject({
          method: "PUT",
          url: `${BASE}/team/me`,
          payload: { relationshipType: "team_member", isFounder: true },
        })
      ).statusCode,
    ).toBe(400);
    await noContext.close();
    expect(calls["upsert"]).toHaveLength(0);
  });

  it("links the caller only: no userId or authority fields are accepted", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const extra of [
      { userId: USER },
      { tenantId: TENANT },
      { organisationId: ORG },
      { role: "organisation_admin" },
      { verified: true },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: `${BASE}/team/me`,
        payload: { relationshipType: "team_member", isFounder: true, ...extra },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(422);
    }
    expect(calls["upsert"]).toHaveLength(0);
    const ok = await app.inject({
      method: "PUT",
      url: `${BASE}/team/me`,
      payload: {
        relationshipType: "team_member",
        businessTitle: "CEO",
        isFounder: true,
      },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<Record<string, unknown>>();
    expect(body["isFounder"]).toBe(true);
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("userId");
    expect(calls["upsert"]?.[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      input: {
        relationshipType: "team_member",
        businessTitle: "CEO",
        isFounder: true,
      },
    });
    const get = await app.inject({ method: "GET", url: `${BASE}/team/me` });
    expect(get.statusCode).toBe(200);
    await app.close();
  });
});

describe("founder-profile/me", () => {
  it("refuses private or authority fields and maps founder ineligibility to 403", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const extra of [
      { userId: USER },
      { primaryCompanyId: COMPANY },
      { visibilityScope: "public_external" },
      { privateQConversation: "x" },
      { verified: true },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: `${BASE}/founder-profile/me`,
        payload: { professionalSummary: "x", ...extra },
      });
      expect(response.statusCode, JSON.stringify(extra)).toBe(422);
    }
    expect(calls["profile"]).toHaveLength(0);
    const ok = await app.inject({
      method: "PATCH",
      url: `${BASE}/founder-profile/me`,
      payload: { professionalSummary: "Rail engineer" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Record<string, unknown>>()).not.toHaveProperty(
      "visibilityScope",
    );
    await app.close();

    const denied = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        getMyFounderProfile: () =>
          Promise.reject(new FounderProfileNotAllowedError()),
      }).service,
    });
    const response = await denied.inject({
      method: "GET",
      url: `${BASE}/founder-profile/me`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
    await denied.close();
  });
});

describe("team-facts", () => {
  it("reads, updates and maps version conflicts", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const get = await app.inject({ method: "GET", url: `${BASE}/team-facts` });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ founderCount: number }>().founderCount).toBe(3);
    const bad = await app.inject({
      method: "PATCH",
      url: `${BASE}/team-facts`,
      payload: { expectedVersion: 1, founderCount: -1 },
    });
    expect(bad.statusCode).toBe(422);
    const ok = await app.inject({
      method: "PATCH",
      url: `${BASE}/team-facts`,
      payload: { expectedVersion: 1, teamSize: 12 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ version: number }>().version).toBe(2);
    expect(calls["facts"]?.[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      input: { expectedVersion: 1, teamSize: 12 },
    });
    await app.close();

    const stale = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: fakeService({
        updateCompanyTeamFacts: () =>
          Promise.reject(new TeamVersionConflictError(2, "team facts")),
      }).service,
    });
    const response = await stale.inject({
      method: "PATCH",
      url: `${BASE}/team-facts`,
      payload: { expectedVersion: 1, teamSize: 12 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("VERSION_CONFLICT");
    await stale.close();
  });
});
