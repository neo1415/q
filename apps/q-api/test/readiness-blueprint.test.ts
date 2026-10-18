import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type {
  EntitlementDecision,
  EntitlementService,
} from "@capital-q/billing";
import {
  BlueprintStepSchema,
  Q_READINESS_BLUEPRINTS_PATH,
  ReadinessBlueprintDtoSchema,
  ReadinessBlueprintRequestSchema,
} from "@capital-q/contracts";
import {
  ActorContextSchema,
  AuthUserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  assess,
  buildBlueprint,
  READINESS_RULES_V1,
} from "@capital-q/readiness";

import {
  BLUEPRINT_NOT_BUILT,
  registerReadinessBlueprintRoutes,
} from "../src/http/readiness-blueprint.js";

/**
 * BILLING-2 (ADR 0036): the Readiness Blueprint's route is fixed before
 * the feature is built. A plan without it says so (402); a plan with it
 * is told plainly it is not built yet (501). Nothing is read or generated.
 */

const ACTOR: ActorContext = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const COMPANY = "f0000000-0000-4000-8000-000000000001";

function app(
  decision: EntitlementDecision,
  blueprints?: Parameters<
    typeof registerReadinessBlueprintRoutes
  >[1]["blueprints"],
) {
  const checked: string[] = [];
  const entitlements: Pick<EntitlementService, "check"> = {
    check: (_account, feature) => {
      checked.push(feature);
      return Promise.resolve(decision);
    },
  };
  const server = Fastify();
  registerReadinessBlueprintRoutes(server, {
    authenticator: {
      authenticate: () =>
        Promise.resolve({
          authUserId: AuthUserIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
        }),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: ACTOR }),
    },
    entitlements,
    blueprints,
  });
  return { server, checked };
}

describe("POST /v1/q/readiness-blueprints (stub)", () => {
  it("tells a plan without the blueprint that its plan does not include it", async () => {
    const { server, checked } = app({
      allowed: false,
      refusal: {
        feature: "q.readiness_blueprint",
        featureName: "Capital Readiness Blueprint",
        reason: "NOT_IN_PLAN",
        planKey: "free",
        planName: "Free",
        limit: null,
        used: null,
        resetsAt: null,
        upgradePath: "/settings/plan",
        message:
          "Capital Readiness Blueprint isn't included in your Free plan. You can see what each plan includes in Settings → Plan.",
      },
    });
    const response = await server.inject({
      method: "POST",
      url: Q_READINESS_BLUEPRINTS_PATH,
      payload: { companyId: COMPANY },
    });
    expect(response.statusCode).toBe(402);
    expect(response.json<{ code: string }>().code).toBe("ENTITLEMENT_REQUIRED");
    expect(checked).toEqual(["q.readiness_blueprint"]);
    await server.close();
  });

  it("tells a plan with the blueprint plainly that it is not built yet (501), with no content", async () => {
    const { server } = app({ allowed: true, remaining: null, replayed: false });
    const response = await server.inject({
      method: "POST",
      url: Q_READINESS_BLUEPRINTS_PATH,
      payload: { companyId: COMPANY, horizonMonths: 6 },
    });
    expect(response.statusCode).toBe(501);
    const body = response.json<{ code: string; detail: string }>();
    expect(body.code).toBe("NOT_IMPLEMENTED");
    expect(body.detail).toBe(BLUEPRINT_NOT_BUILT);
    expect(Object.keys(body)).not.toContain("roadmap");
    await server.close();
  });

  it("refuses a malformed request before anything else", async () => {
    const { server, checked } = app({
      allowed: true,
      remaining: null,
      replayed: false,
    });
    const response = await server.inject({
      method: "POST",
      url: Q_READINESS_BLUEPRINTS_PATH,
      payload: { companyId: "not-a-uuid", horizonMonths: 9 },
    });
    expect(response.statusCode).toBe(400);
    expect(checked).toEqual([]);
    await server.close();
  });
});

describe("POST /v1/q/readiness-blueprints (Blueprint v1)", () => {
  const allowed = { allowed: true, remaining: null, replayed: false } as const;

  it("builds it from the founder's own diagnosis, by code, after the plan gate", async () => {
    const assessment = assess(
      {
        stageCode: "seed",
        profile: { description: true, website: true, categories: 1 },
        team: {
          founderCount: 2,
          fullTimeFounderCount: 2,
          teamSize: 6,
          founderBackgrounds: 0,
          verifiedFounderIdentities: 0,
        },
        verification: { organisation: false, domain: false },
        claims: [],
        deck: null,
        dataRoom: null,
        raise: null,
        followUps: [],
      },
      READINESS_RULES_V1,
    );
    const asked: string[] = [];
    const { server } = app(allowed, {
      blueprint: (actor, companyId, horizon) => {
        asked.push(`${actor.userId}:${companyId}:${String(horizon)}`);
        return Promise.resolve(
          buildBlueprint({
            id: "90000000-0000-4000-8000-000000000001",
            companyId,
            version: 1,
            horizonMonths: horizon,
            assessment,
            evidenceAsOf: "2026-10-07T00:00:00.000Z",
            generatedAt: "2026-10-07T00:00:00.000Z",
          }),
        );
      },
    });
    const response = await server.inject({
      method: "POST",
      url: Q_READINESS_BLUEPRINTS_PATH,
      payload: { companyId: COMPANY, horizonMonths: 3 },
    });
    expect(response.statusCode).toBe(200);
    const body = ReadinessBlueprintDtoSchema.parse(response.json());
    expect(body.roadmap.length).toBeGreaterThan(0);
    expect(body.roadmap.every((step) => step.closesGapId !== null)).toBe(true);
    expect(asked).toEqual([`${ACTOR.userId}:${COMPANY}:3`]);
    await server.close();
  });

  it("answers 404 for a company that is not the actor's own", async () => {
    const { server } = app(allowed, {
      blueprint: () => Promise.resolve(null),
    });
    const response = await server.inject({
      method: "POST",
      url: Q_READINESS_BLUEPRINTS_PATH,
      payload: { companyId: COMPANY },
    });
    expect(response.statusCode).toBe(404);
    await server.close();
  });
});

describe("the blueprint contracts", () => {
  it("bound the request: own company, a known horizon, at most five investors", () => {
    expect(
      ReadinessBlueprintRequestSchema.parse({ companyId: COMPANY }),
    ).toEqual({
      companyId: COMPANY,
      horizonMonths: 6,
      investorOrganisationIds: [],
    });
    expect(
      ReadinessBlueprintRequestSchema.safeParse({
        companyId: COMPANY,
        investorOrganisationIds: Array.from({ length: 6 }, () => COMPANY),
      }).success,
    ).toBe(false);
  });

  it("keep truth class, evidence status and confidence as separate axes on every step", () => {
    const step = {
      id: "monthly-accounts",
      title: "Close monthly management accounts",
      why: "Investors at seed ask for twelve months of accounts.",
      closesGapId: "gap-financial-reporting",
      pillar: "BUSINESS_ECONOMICS",
      priority: "NOW",
      effort: "WEEKS",
      executor: "WITH_Q",
      dependsOn: [],
      doneWhen: "Twelve months of accounts are uploaded.",
      evidence: [],
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      confidence: "INSUFFICIENT_EVIDENCE",
    };
    expect(BlueprintStepSchema.safeParse(step).success).toBe(true);
    expect(
      BlueprintStepSchema.safeParse({ ...step, verified: true }).success,
    ).toBe(false);
    expect(
      BlueprintStepSchema.safeParse({ ...step, pillar: "VIBES" }).success,
    ).toBe(false);
    expect(
      ReadinessBlueprintDtoSchema.safeParse({
        id: COMPANY,
        companyId: COMPANY,
        version: 1,
        horizonMonths: 6,
        basis: {
          diagnosisVersion: "investiq-v1",
          evidenceAsOf: "2026-10-01T00:00:00.000Z",
          mandateVersions: [],
        },
        roadmap: [step],
        sequencing: [
          {
            label: "First month",
            startsWeek: 0,
            endsWeek: 4,
            stepIds: ["monthly-accounts"],
          },
        ],
        investorPlans: [],
        uncertainty: ["No financial documents were uploaded."],
        generatedAt: "2026-10-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
