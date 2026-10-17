import { describe, expect, it, vi } from "vitest";
import { parseQApiConfig } from "@capital-q/config/q-api";
import {
  FIT_PARAMETERS,
  UnicornPotentialDtoSchema,
  notAssessedInvestability,
  type FitParameter,
} from "@capital-q/contracts";
import {
  assessFit,
  FIT_CONFIG_CURRENT,
  unknownObservation,
  type FitObservation,
  type FitProfilesResult,
} from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";
import type { EntitlementDecision } from "@capital-q/billing";
import { createApp } from "../src/app.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: ActorContext = {
  userId: UserIdSchema.parse(id(1)),
  tenantId: TenantIdSchema.parse(id(2)),
  organisationId: OrganisationIdSchema.parse(id(3)),
  membershipId: MembershipIdSchema.parse(id(4)),
  actorType: "HUMAN",
};
const score = UnicornPotentialDtoSchema.parse({
  status: "NOT_ASSESSED",
  overallScore: null,
  band: null,
  confidence: "LOW",
  coverage: 0,
  stage: null,
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-potential-inputs.v1",
  assessedAt: null,
  pillars: [],
  up: [],
  down: [],
  missing: [],
  momentum: null,
  benchmark: "Comparable benchmark unavailable",
});
const allowed: EntitlementDecision = {
  allowed: true,
  remaining: null,
  replayed: false,
};
const denied: EntitlementDecision = {
  allowed: false,
  refusal: {
    feature: "intelligence.unicorn_potential",
    featureName: "Unicorn Potential",
    reason: "NOT_IN_PLAN",
    planKey: "free",
    planName: "Free",
    limit: 0,
    used: 0,
    resetsAt: null,
    upgradePath: "/settings/plan",
    message: "Unicorn Potential is not included in this plan.",
  },
};
function build(
  options: {
    authenticated?: boolean;
    visible?: boolean;
    access?: EntitlementDecision;
  } = {},
) {
  const profiles = vi.fn(
    (
      _actor: ActorContext,
      ids: readonly string[],
    ): Promise<FitProfilesResult> =>
      Promise.resolve({
        kind: "OK",
        items:
          options.visible === false
            ? []
            : ids.map((companyId) => ({
                name: "Authorized company",
                line: null,
                assessment: assessFit(
                  {
                    companyId,
                    observations: Object.fromEntries(
                      FIT_PARAMETERS.map((p) => [p, unknownObservation()]),
                    ) as Record<FitParameter, FitObservation>,
                    hardRule: null,
                  },
                  FIT_CONFIG_CURRENT,
                  "2026-10-17T00:00:00.000Z",
                ),
                scores: {
                  companyId,
                  investability: notAssessedInvestability("investiq/v2"),
                  suitability: null,
                  unicornPotential: score,
                },
              })),
      }),
  );
  const access = vi.fn(() => Promise.resolve(options.access ?? allowed));
  const { app } = createApp(
    parseQApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve(
            options.authenticated === false
              ? null
              : { authUserId: AuthUserIdSchema.parse(id(5)) },
          ),
      },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "RESOLVED", context: actor }),
      },
    },
    {
      fit: {
        fit: {
          profiles,
          top: () => Promise.resolve({ kind: "NOT_INVESTOR" }),
          compare: () => Promise.resolve({ kind: "NOT_INVESTOR" }),
        },
        qViews: { viewFor: () => Promise.reject(new Error("not called")) },
        unicornAccess: access,
      },
    },
  );
  return { app, profiles, access };
}
const url = `/v1/intelligence/companies/${id(10)}/unicorn-potential`;
describe("premium Unicorn Potential HTTP", () => {
  it("refuses anonymous requests before entitlement or company retrieval", async () => {
    const { app, profiles, access } = build({ authenticated: false });
    try {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(401);
      expect(profiles).not.toHaveBeenCalled();
      expect(access).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("returns the canonical plan refusal before a free actor can probe any company", async () => {
    const { app, profiles } = build({ access: denied });
    try {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(402);
      expect(r.json()).toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
      expect(profiles).not.toHaveBeenCalled();
      expect(r.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
  it("does not expose a score for a company excluded by the reader's own eligibility", async () => {
    const { app, profiles } = build({ visible: false });
    try {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(404);
      expect(profiles).toHaveBeenCalledWith(actor, [id(10)]);
      expect(r.body).not.toContain("unicorn-potential.v1");
    } finally {
      await app.close();
    }
  });
  it("serves the exact saved authorized assessment without a model or fabricated number", async () => {
    const { app } = build();
    try {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual(score);
      expect(r.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });
});
