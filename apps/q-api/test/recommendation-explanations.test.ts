import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type {
  ExplainRecommendationQuery,
  ExplainResult,
  RecommendationExplanationService,
} from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/**
 * `GET /v1/discovery/slates/:slateId/companies/:companyId/explanation`
 * (CQ-REC-007 D).
 *
 * What this pins: the actor comes from the verified session and never the
 * path; every refusal is the same 404, so a probe cannot tell somebody
 * else's slate from one that does not exist; and the DTO carries the
 * declared factors and no internal arithmetic.
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

const SLATE = "55555555-0000-4000-8000-000000000001";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const URL = `/v1/discovery/slates/${SLATE}/companies/${COMPANY}/explanation`;

const EXPLAINED: ExplainResult = {
  kind: "EXPLAINED",
  explanation: {
    explanationVersion: "recommendation-explanation.v1",
    slateId: SLATE,
    companyId: COMPANY,
    rank: 1,
    summary:
      "Stage and geography match what your mandate names. Sector does not match.",
    matchedFactors: [
      {
        dimension: "STAGE",
        outcome: "MATCH",
        label: "Stage matches the stage your mandate names",
        reasonCode: "STAGE_ALIGNED",
      },
    ],
    mismatchedFactors: [
      {
        dimension: "TAXONOMY",
        outcome: "MISMATCH",
        label: "Sector is not one your mandate names",
        reasonCode: "TAXONOMY_MISMATCH",
      },
    ],
    uncertainties: [],
    generatedFromRankingVersion: "deterministic-ranker.v1/ranking-config.v1",
    source: "Q_SYNTHESIZED",
  },
};

function buildApp(options: {
  readonly result: ExplainResult;
  readonly principal?: AuthenticatedPrincipal | null;
}): {
  readonly app: FastifyInstance;
  readonly queries: ExplainRecommendationQuery[];
} {
  const queries: ExplainRecommendationQuery[] = [];
  const explanations: RecommendationExplanationService = {
    explain: (query) => {
      queries.push(query);
      return Promise.resolve(options.result);
    },
  };
  const security: QApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          options.principal === undefined ? PRINCIPAL : options.principal,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    recommendationExplanations: explanations,
  });
  return { app, queries };
}

describe("GET /v1/discovery/slates/:slateId/companies/:companyId/explanation", () => {
  it("serves the explanation for the session's actor, carrying factors and no arithmetic", async () => {
    const { app, queries } = buildApp({ result: EXPLAINED });
    const response = await app.inject({ method: "GET", url: URL });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    // The actor is resolved, never read from the path.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.actor).toEqual(CONTEXT);
    expect(queries[0]?.slateId).toBe(SLATE);
    expect(queries[0]?.companyId).toBe(COMPANY);
    expect(queries[0]?.correlationId).toMatch(/^cor_/);

    const body: Record<string, unknown> = response.json();
    expect(body["rank"]).toBe(1);
    expect(body["source"]).toBe("Q_SYNTHESIZED");
    expect(body["generatedFromRankingVersion"]).toBe(
      "deterministic-ranker.v1/ranking-config.v1",
    );
    expect(body["matchedFactors"]).toEqual([
      {
        dimension: "STAGE",
        outcome: "MATCH",
        label: "Stage matches the stage your mandate names",
        reasonCode: "STAGE_ALIGNED",
      },
    ]);
    // Nothing the ranker kept to itself, and no version chatter.
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(
      /internalScore|featureSnapshot|fingerprint|contribution|normalizedValue|explanationVersion/i,
    );
    await app.close();
  });

  it("every refusal is the same 404, byte for byte, whoever the slate belongs to", async () => {
    const bodies: string[] = [];
    for (const refusal of [
      "NOT_FOUND",
      "SNAPSHOT_UNAVAILABLE",
      "RANKING_VERSION_UNAVAILABLE",
    ] as const) {
      const { app } = buildApp({ result: { kind: "REFUSED", refusal } });
      const response = await app.inject({ method: "GET", url: URL });
      expect(response.statusCode).toBe(404);
      // The distinction an operator needs is in the metrics. A caller who
      // could tell "the snapshot is gone" from "this is not yours" would
      // have learned that the slate exists.
      expect(response.body).not.toContain("SNAPSHOT_UNAVAILABLE");
      expect(response.body).not.toContain("RANKING_VERSION_UNAVAILABLE");
      expect(response.body).not.toContain(SLATE);
      bodies.push(
        response.body
          .replace(/"instance":"[^"]*"/, "")
          .replace(/[0-9a-f-]{36}/g, ""),
      );
      await app.close();
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("a malformed identifier names nothing, and reaches no service call", async () => {
    const { app, queries } = buildApp({ result: EXPLAINED });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/slates/not-a-uuid/companies/also-not/explanation",
    });
    expect(response.statusCode).toBe(404);
    expect(queries).toHaveLength(0);
    await app.close();
  });

  it("requires an authenticated session", async () => {
    const { app, queries } = buildApp({ result: EXPLAINED, principal: null });
    const response = await app.inject({ method: "GET", url: URL });
    expect(response.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
    await app.close();
  });
});
