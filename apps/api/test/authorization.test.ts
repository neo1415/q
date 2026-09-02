import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  AuthUserIdSchema,
  capability,
  createAuthorizationService,
  MembershipIdSchema,
  OrganisationIdSchema,
  ResourceIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type ActorContextResolver,
  type AuthorizationPolicySource,
  type ResourceScope,
} from "@capital-q/security";

import { createApp } from "../src/app.js";
import {
  getActorContext,
  requireActorContextHook,
  type RequestAuthenticator,
} from "../src/security/actor-context.js";

// Synthetic only.
const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const COMPANY_A = ResourceIdSchema.parse(
  "f0000000-0000-4000-8000-00000000000a",
);
const COMPANY_B = ResourceIdSchema.parse(
  "f0000000-0000-4000-8000-00000000000b",
);
const VIEW = capability("company.financials.view");

const humanA: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-00000000000a"),
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-00000000000a",
  ),
  actorType: "HUMAN",
};

const companyScope = (resourceId: typeof COMPANY_A): ResourceScope => ({
  kind: "RESOURCE",
  tenantId: TENANT_A,
  organisationId: ORG_A,
  resourceType: "company",
  resourceId,
});

const authenticated: RequestAuthenticator = {
  authenticate: () =>
    Promise.resolve({
      authUserId: AuthUserIdSchema.parse(
        "a0000000-0000-4000-8000-00000000000a",
      ),
    }),
};

const resolver: ActorContextResolver = {
  resolveHumanContext: () =>
    Promise.resolve({ status: "RESOLVED", context: humanA }),
};

/** Grants VIEW on company A only. Test double, never production. */
const companyAOnly: AuthorizationPolicySource = {
  getPolicyFacts: () =>
    Promise.resolve({
      grants: [{ capability: VIEW, scope: companyScope(COMPANY_A) }],
      denials: [],
      unmetRequirements: [],
    }),
};

function buildApp() {
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }));
  const authorization = createAuthorizationService(companyAOnly);

  // Proves the handler body is not reached on a denial, not merely that a 403
  // came back.
  let handlerExecutions = 0;

  app.get<{ Params: { companyId: string } }>(
    "/__fixture/companies/:companyId/financials",
    {
      onRequest: requireActorContextHook({
        authenticator: authenticated,
        resolver,
      }),
    },
    async (request) => {
      // The route does not decide anything itself: it names the capability
      // and the exact object and asks the central service.
      await authorization.requireCapability({
        actor: getActorContext(request),
        capability: VIEW,
        resource: companyScope(
          ResourceIdSchema.parse(request.params.companyId),
        ),
      });

      handlerExecutions += 1;
      return { ok: true, companyId: request.params.companyId };
    },
  );

  return { app, executions: () => handlerExecutions };
}

describe("capability authorization over HTTP", () => {
  it("allows the granted object and runs the handler", async () => {
    const { app, executions } = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/__fixture/companies/${COMPANY_A}/financials`,
      headers: { "x-organisation-id": ORG_A },
    });

    expect(response.statusCode).toBe(200);
    expect(executions()).toBe(1);
    await app.close();
  });

  it("denies a sibling object with a valid id and never runs the handler", async () => {
    // BOLA/IDOR baseline: company B is real, well-formed, in the same tenant
    // and organisation. Access to A is not access to B.
    const { app, executions } = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/__fixture/companies/${COMPANY_B}/financials`,
      headers: { "x-organisation-id": ORG_A },
    });

    expect(response.statusCode).toBe(403);
    expect(String(response.headers["content-type"])).toContain(
      "application/problem+json",
    );

    const body = response.json<Record<string, unknown>>();
    expect(body["code"]).toBe("PERMISSION_DENIED");
    // No internal reason, no resource id, no scope detail leaks out.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("NO_MATCHING_GRANT");
    expect(serialised).not.toContain(COMPANY_B);
    expect(serialised).not.toContain("grant");

    expect(executions()).toBe(0);
    await app.close();
  });

  it("ignores hostile role claims from the client", async () => {
    const { app, executions } = buildApp();

    const response = await app.inject({
      method: "GET",
      url: `/__fixture/companies/${COMPANY_B}/financials`,
      headers: {
        "x-organisation-id": ORG_A,
        "x-actor-role": "ADMIN",
        "x-role": "SUPER_ADMIN",
        "x-capabilities": "company.financials.view",
      },
    });

    // Still denied: authority comes from ActorContext + trusted policy facts,
    // and nothing a client sends participates.
    expect(response.statusCode).toBe(403);
    expect(executions()).toBe(0);
    await app.close();
  });
});
