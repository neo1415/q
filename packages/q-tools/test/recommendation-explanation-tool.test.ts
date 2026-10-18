import { describe, expect, it } from "vitest";

import type { ExplainResult } from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  RECOMMENDATION_EXPLANATION,
} from "../src/index.js";
import {
  actorB,
  COMPANY_A,
  contextFor,
  fakePorts,
  INVESTOR_B,
  planFor,
} from "./support.js";

/**
 * `recommendation.explanation` (CQ-REC-007R B; doc 19 §57-§59).
 *
 * The tool is the seam between the two halves of §59 -- the ranking engine
 * decides, Q explains -- so what is worth testing is that it carries
 * exactly the ranker's answer and nothing else: no score, no position, no
 * slate id from the caller, and no tool at all where no explanation
 * service is composed.
 */

const EXPLAINED: ExplainResult = {
  kind: "EXPLAINED",
  explanation: {
    explanationVersion: "recommendation-explanation.v1",
    slateId: "55555555-0000-4000-8000-000000000001",
    companyId: COMPANY_A,
    rank: 1,
    summary: "It matches on stage. The sector could not be established.",
    matchedFactors: [
      {
        dimension: "STAGE",
        outcome: "MATCH",
        label: "Seed, inside the declared range",
        reasonCode: "STAGE_ALIGNED",
      },
    ],
    mismatchedFactors: [
      {
        dimension: "GEOGRAPHY",
        outcome: "MISMATCH",
        label: "outside the declared markets",
        reasonCode: "GEOGRAPHY_MISMATCH",
      },
    ],
    uncertainties: [
      {
        dimension: "TAXONOMY",
        outcome: "UNKNOWN",
        label: "sector not established",
        reasonCode: "FACTOR_MISSING",
      },
    ],
    generatedFromRankingVersion: "ranking-config.v1",
    source: "DETERMINISTIC",
  },
};

const investorPlan = planFor(actorB, "INVESTOR_QUESTION", [
  {
    kind: "INVESTOR_MANDATE",
    sensitivity: "CONFIDENTIAL",
    investorOrganisationId: INVESTOR_B,
  },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

function toolsWith(result: ExplainResult | null) {
  const calls: { companyId: string }[] = [];
  const ports = fakePorts(
    result === null
      ? {}
      : {
          recommendationExplanations: {
            explainCurrent: (query) => {
              calls.push({ companyId: query.companyId });
              return Promise.resolve(result);
            },
          },
        },
  );
  return {
    calls,
    registry: createQToolRegistry(createDefaultQTools(ports)),
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

describe("RECOMMENDATION_EXPLANATION", () => {
  it("does not exist where no explanation service is composed", () => {
    const { registry } = toolsWith(null);
    expect(
      registry.list().some((r) => r.versionId.startsWith("recommendation")),
    ).toBe(false);
  });

  it("returns the ranker's factors, and never a score or a position", async () => {
    const { port, calls } = toolsWith(EXPLAINED);
    const outcome = await port.execute(
      {
        callId: "c1",
        name: "recommendation_explanation",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = outcome.result.data as Record<string, unknown>;
    expect(data["status"]).toBe("EXPLAINED");
    expect(data["rankingVersion"]).toBe("ranking-config.v1");
    expect(data["matched"]).toEqual([
      {
        dimension: "STAGE",
        outcome: "MATCH",
        label: "Seed, inside the declared range",
      },
    ]);
    // A rank is not a reason, and a number in an explanation becomes
    // arithmetic the moment a model phrases it (doc 19 section 56).
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('rank":');
    expect(serialised).not.toContain("internalScore");
    expect(serialised).not.toContain("0.8");
    // The reason codes are the ranker's internal vocabulary; the reader
    // gets the label, and the model is given no code to quote.
    expect(serialised).not.toContain("STAGE_ALIGNED");
    expect(calls).toEqual([{ companyId: COMPANY_A }]);
  });

  it("accepts no slate id from the caller", () => {
    const { registry } = toolsWith(EXPLAINED);
    const record = registry
      .list()
      .find((r) => r.versionId.startsWith(RECOMMENDATION_EXPLANATION));
    expect(record).toBeDefined();
    // A slate id arriving from a model would be a claim of authority. The
    // schema is strict, so there is nowhere to put one.
    const parsed = record?.definition.input.safeParse({
      companyId: COMPANY_A,
      slateId: "55555555-0000-4000-8000-000000000001",
    });
    expect(parsed?.success).toBe(false);
  });

  it("reports a company it never recommended as exactly that", async () => {
    const { port } = toolsWith({ kind: "REFUSED", refusal: "NOT_FOUND" });
    const outcome = await port.execute(
      {
        callId: "c1",
        name: "recommendation_explanation",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = outcome.result.data as Record<string, unknown>;
    expect(data["status"]).toBe("NOT_RECOMMENDED");
    expect(data["summary"]).toBeNull();
    expect(data["matched"]).toEqual([]);
  });

  it("tells a stale slate and a missing one apart nowhere a model can see", async () => {
    // SNAPSHOT_UNAVAILABLE is an operational fact. Handing a model the
    // difference would invite it to explain the difference.
    const { port } = toolsWith({
      kind: "REFUSED",
      refusal: "SNAPSHOT_UNAVAILABLE",
    });
    const outcome = await port.execute(
      {
        callId: "c1",
        name: "recommendation_explanation",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    expect((outcome.result.data as Record<string, unknown>)["status"]).toBe(
      "NOT_RECOMMENDED",
    );
  });

  it("is not offered to a plan without network-visible scope", async () => {
    const { port } = toolsWith(EXPLAINED);
    const narrowPlan = planFor(actorB, "INVESTOR_QUESTION", [
      {
        kind: "INVESTOR_MANDATE",
        sensitivity: "CONFIDENTIAL",
        investorOrganisationId: INVESTOR_B,
      },
    ]);
    const outcome = await port.execute(
      {
        callId: "c1",
        name: "recommendation_explanation",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, narrowPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.result.ok).toBe(false);
  });
});
