import { describe, expect, it } from "vitest";

import { CompanyNotFoundError } from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
import type { AudiencePreviewDto } from "@capital-q/contracts";
import {
  DisclosurePolicyNotFoundError,
  type VisibilityCentre,
} from "@capital-q/permissions";
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
 * `/v1/companies/:companyId/visibility/…` over HTTP (CQ-BIZ-003).
 *
 * The permissions context decides; this is the trust boundary: the actor
 * is the server-resolved one, the preview's audience is validated, a
 * share needs its key and names only a relationship, and every refusal
 * about a company or a share is the same 404.
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
const COMPANY = "22222222-0000-4000-8000-000000000001";
const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const POLICY = "99999999-0000-4000-8000-000000000001";
const BASE = `/v1/companies/${COMPANY}/visibility`;

type Calls = { name: string; input: Record<string, unknown> }[];

function buildApp(fail?: Error) {
  const calls: Calls = [];
  const record = <T>(name: string, input: object, value: T): Promise<T> => {
    calls.push({ name, input: input as Record<string, unknown> });
    return fail === undefined ? Promise.resolve(value) : Promise.reject(fail);
  };
  const preview: AudiencePreviewDto = {
    audience: "NETWORK",
    relationshipId: null,
    profile: null,
    capitalObjective: null,
  };
  const visibility: VisibilityCentre = {
    state: (query) =>
      record("state", query, {
        companyId: COMPANY,
        objects: [],
        shares: [],
        relationships: [],
      }),
    preview: (query) =>
      record("preview", query, {
        ...preview,
        audience: query.audience,
        relationshipId: query.relationshipId ?? null,
      }),
    share: (command) =>
      record("share", command, { outcome: "REDUNDANT", share: null }),
    revoke: (command) => record("revoke", command, { outcome: "REVOKED" }),
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
    visibility,
  });
  return { app, calls };
}

describe("the visibility control centre over HTTP", () => {
  it("reads state and previews as the server-resolved actor", async () => {
    const { app, calls } = buildApp();
    const state = await app.inject({ method: "GET", url: `${BASE}/state` });
    expect(state.statusCode).toBe(200);
    expect(state.headers["cache-control"]).toBe("no-store");
    const investor = await app.inject({
      method: "GET",
      url: `${BASE}/preview?audience=INVESTOR&relationshipId=${RELATIONSHIP}`,
    });
    expect(investor.statusCode).toBe(200);
    expect(investor.json()).toMatchObject({
      audience: "INVESTOR",
      relationshipId: RELATIONSHIP,
    });
    expect(calls.map((c) => [c.name, c.input["actor"]])).toEqual([
      ["state", CONTEXT],
      ["preview", CONTEXT],
    ]);
  });

  it("refuses an audience it does not know, and a relationship where none belongs", async () => {
    const { app, calls } = buildApp();
    for (const query of [
      "audience=EVERYONE",
      "audience=INVESTOR",
      `audience=NETWORK&relationshipId=${RELATIONSHIP}`,
      "",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `${BASE}/preview?${query}`,
      });
      expect(response.statusCode, query).toBe(422);
    }
    expect(calls).toEqual([]);
  });

  it("shares only with a key and names nothing but the object and relationship", async () => {
    const { app, calls } = buildApp();
    const body = { object: "CAPITAL_OBJECTIVE", relationshipId: RELATIONSHIP };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${BASE}/shares`,
          payload: body,
        })
      ).statusCode,
    ).toBe(422);
    for (const extra of [
      { tenantId: CONTEXT.tenantId },
      { recipient: { type: "ORGANISATION", id: RELATIONSHIP } },
      { object: "COMPANY_PROFILE" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `${BASE}/shares`,
        payload: { ...body, ...extra },
        headers: { "idempotency-key": "share:0001-aaaa-bbbb" },
      });
      expect(response.statusCode).toBe(422);
    }
    expect(calls).toEqual([]);
    const ok = await app.inject({
      method: "POST",
      url: `${BASE}/shares`,
      payload: body,
      headers: { "idempotency-key": "share:0001-aaaa-bbbb" },
    });
    expect(ok.statusCode).toBe(200);
    expect(calls[0]).toMatchObject({
      name: "share",
      input: {
        actor: CONTEXT,
        companyId: COMPANY,
        relationshipId: RELATIONSHIP,
      },
    });
  });

  it("answers the same 404 for someone else's company and for a share not on it", async () => {
    for (const error of [
      new CompanyNotFoundError(),
      new DisclosurePolicyNotFoundError(),
    ]) {
      const { app } = buildApp(error);
      const state = await app.inject({ method: "GET", url: `${BASE}/state` });
      const revoke = await app.inject({
        method: "POST",
        url: `${BASE}/shares/${POLICY}/revoke`,
      });
      expect(state.statusCode).toBe(404);
      expect(revoke.statusCode).toBe(404);
      const code = (body: unknown) => (body as { code?: unknown }).code;
      expect(code(state.json())).toBe(code(revoke.json()));
    }
  });

  it("says plainly when the caller may look but not share", async () => {
    const { app } = buildApp(new AuthorizationDeniedError("NO_MATCHING_GRANT"));
    const response = await app.inject({
      method: "POST",
      url: `${BASE}/shares`,
      payload: { object: "CAPITAL_OBJECTIVE", relationshipId: RELATIONSHIP },
      headers: { "idempotency-key": "share:0001-aaaa-bbbb" },
    });
    expect(response.statusCode).toBe(403);
  });
});
