import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import type { QCardDto } from "@capital-q/contracts";
import {
  HandleUnavailableError,
  QCardSubjectNotFoundError,
  type CardAudience,
  type PublicIdentityService,
} from "@capital-q/public-identity";
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
 * HTTP adaptation of handles and the Q Card (BIZ-004). The service is a
 * recording double; its rules are proven against the database in the
 * public-identity package. What this holds: owner routes need a session
 * and an organisation, the public read decides its audience from a
 * verified session only, refusals map to stable problems, and nothing
 * public is indexable through the API.
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
const COMPANY = "f0000000-0000-4000-8000-000000000001";

const CARD: QCardDto = {
  subjectType: "COMPANY",
  subjectId: COMPANY,
  handle: "kivu",
  publicCode: "abcdefgh23",
  fieldScopes: { canonicalName: "public_external" },
  indexable: false,
  scansLast30Days: 0,
  version: 1,
  updatedAt: "2026-09-26T10:00:00.000Z",
};

function service(overrides: Partial<PublicIdentityService> = {}) {
  const calls = {
    audiences: [] as CardAudience[],
    claims: [] as string[],
  };
  const fake: PublicIdentityService = {
    getCard: () => Promise.resolve(CARD),
    claimHandle: (input) => {
      calls.claims.push(input.handle);
      return Promise.resolve(CARD);
    },
    updateCard: () => Promise.resolve({ ...CARD, version: 2 }),
    handleAvailable: () => Promise.resolve(true),
    resolveHandle: ({ handle, audience }) => {
      calls.audiences.push(audience);
      if (handle === "old") {
        return Promise.resolve({ kind: "REDIRECT", handle: "kivu" });
      }
      if (handle !== "kivu") return Promise.resolve(null);
      return Promise.resolve({
        kind: "CARD",
        handle: "kivu",
        subjectType: "COMPANY",
        name: "Kivu Freight",
        fields: [],
        verified: [],
        demoAttested: [],
        audience,
        indexable: false,
      });
    },
    resolveCode: (code) =>
      Promise.resolve(code === "abcdefgh23" ? { handle: "kivu" } : null),
    ...overrides,
  };
  return { fake, calls };
}

function buildApp(
  publicIdentity: PublicIdentityService,
  options: {
    readonly principal?: AuthenticatedPrincipal | null;
    readonly person?: boolean;
    readonly context?: boolean;
  } = {},
): FastifyInstance {
  const principal =
    options.principal === undefined ? PRINCIPAL : options.principal;
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === false
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: CONTEXT },
        ),
    },
    identities: {
      lookup: () =>
        Promise.resolve(
          options.person === false
            ? null
            : { userId: CONTEXT.userId, displayName: "Ada" },
        ),
    },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    publicIdentity,
  }).app;
}

describe("owner card routes", () => {
  it("require a session and an organisation context", async () => {
    const { fake, calls } = service();
    const anonymous = buildApp(fake, { principal: null });
    const response = await anonymous.inject({
      method: "PUT",
      url: `/v1/q-cards/COMPANY/${COMPANY}/handle`,
      payload: { handle: "kivu" },
    });
    expect(response.statusCode).toBe(401);
    await anonymous.close();

    const noOrganisation = buildApp(fake, { context: false });
    const refused = await noOrganisation.inject({
      method: "GET",
      url: `/v1/q-cards/COMPANY/${COMPANY}`,
    });
    expect(refused.statusCode).toBe(400);
    expect(calls.claims).toEqual([]);
    await noOrganisation.close();
  });

  it("claims through the service and returns the card", async () => {
    const { fake, calls } = service();
    const app = buildApp(fake);
    const response = await app.inject({
      method: "PUT",
      url: `/v1/q-cards/COMPANY/${COMPANY}/handle`,
      payload: { handle: "@Kivu" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<QCardDto>().handle).toBe("kivu");
    expect(calls.claims).toEqual(["@Kivu"]);
    await app.close();
  });

  it("rejects an unknown subject type and extra body fields before the service", async () => {
    const { fake, calls } = service();
    const app = buildApp(fake);
    const badType = await app.inject({
      method: "PUT",
      url: `/v1/q-cards/PERSON/${COMPANY}/handle`,
      payload: { handle: "kivu" },
    });
    expect(badType.statusCode).toBe(422);
    const extra = await app.inject({
      method: "PUT",
      url: `/v1/q-cards/COMPANY/${COMPANY}/handle`,
      payload: { handle: "kivu", subjectId: COMPANY },
    });
    expect(extra.statusCode).toBe(422);
    expect(calls.claims).toEqual([]);
    await app.close();
  });

  it("maps refusals: taken 409, malformed 422, not yours 404, no capability 403", async () => {
    const cases: readonly [Error, number, string][] = [
      [new HandleUnavailableError("TAKEN"), 409, "RESOURCE_CONFLICT"],
      [new HandleUnavailableError("RESERVED"), 409, "RESOURCE_CONFLICT"],
      [new HandleUnavailableError("SHAPE"), 422, "VALIDATION_FAILED"],
      [new QCardSubjectNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
      [
        new AuthorizationDeniedError("NO_MATCHING_GRANT"),
        403,
        "PERMISSION_DENIED",
      ],
    ];
    for (const [error, status, code] of cases) {
      const { fake } = service({ claimHandle: () => Promise.reject(error) });
      const app = buildApp(fake);
      const response = await app.inject({
        method: "PUT",
        url: `/v1/q-cards/COMPANY/${COMPANY}/handle`,
        payload: { handle: "kivu" },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json<{ code: string }>().code).toBe(code);
      await app.close();
    }
  });
});

describe("the public handle read", () => {
  it("serves an anonymous visitor the PUBLIC projection, cacheable and noindex", async () => {
    const { fake, calls } = service();
    const app = buildApp(fake, { principal: null });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/handles/kivu",
    });
    expect(response.statusCode).toBe(200);
    expect(calls.audiences).toEqual(["PUBLIC"]);
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["cache-control"]).toBe("public, max-age=60");
    await app.close();
  });

  it("widens to PARTICIPANT only for a verified session with a Capital Q person, never cached", async () => {
    const { fake, calls } = service();
    const app = buildApp(fake);
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/handles/kivu",
    });
    expect(calls.audiences).toEqual(["PARTICIPANT"]);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    await app.close();

    const stranger = service();
    const noPerson = buildApp(stranger.fake, { person: false });
    await noPerson.inject({ method: "GET", url: "/v1/public/handles/kivu" });
    expect(stranger.calls.audiences).toEqual(["PUBLIC"]);
    await noPerson.close();
  });

  it("answers an unknown handle with one 404, and an old one with its redirect", async () => {
    const { fake } = service();
    const app = buildApp(fake, { principal: null });
    const missing = await app.inject({
      method: "GET",
      url: "/v1/public/handles/nobody",
    });
    expect(missing.statusCode).toBe(404);
    const old = await app.inject({
      method: "GET",
      url: "/v1/public/handles/old",
    });
    expect(old.json()).toEqual({ kind: "REDIRECT", handle: "kivu" });
    await app.close();
  });

  it("resolves a QR code, never cached, and 404s anything else", async () => {
    const { fake } = service();
    const app = buildApp(fake, { principal: null });
    const hit = await app.inject({
      method: "GET",
      url: "/v1/public/cards/abcdefgh23",
    });
    expect(hit.json()).toEqual({ handle: "kivu" });
    expect(hit.headers["cache-control"]).toBe("private, no-store");
    const miss = await app.inject({
      method: "GET",
      url: "/v1/public/cards/zzzzzzzzzz",
    });
    expect(miss.statusCode).toBe(404);
    await app.close();
  });
});
