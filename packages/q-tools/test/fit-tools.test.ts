import { describe, expect, it } from "vitest";

import { fitScoreOutOf10 } from "@capital-q/contracts";
import {
  createFitService,
  type FitCandidate,
  type FitCompanyInputs,
  type RecommendationFeatureSnapshot,
} from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  FitTopCandidatesOutputSchema,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  contextFor,
  fakePorts,
  INVESTOR_B,
  planFor,
} from "./support.js";

/**
 * `fit.profile` and `fit.top_candidates` (B1, B2; ADR 0052). The tools
 * carry the platform's fit and nothing else: the investor's own
 * candidates only, a company they may not see absent, no internal value,
 * no tool where fit is not composed.
 */

const MANDATE = "e0000000-0000-4000-8000-000000000001";

const snapshot = (stage: string): RecommendationFeatureSnapshot =>
  ({
    features: [
      {
        featureId: "declared_fit.stage",
        status: "PRESENT",
        value: stage,
        missingReason: null,
      },
      {
        featureId: "declared_fit.taxonomy",
        status: "PRESENT",
        value: "EXACT_OVERLAP",
        missingReason: null,
      },
      {
        featureId: "declared_fit.geography",
        status: "PRESENT",
        value: "COUNTRY_MATCH",
        missingReason: null,
      },
    ],
  }) as unknown as RecommendationFeatureSnapshot;

function tools(
  options: { candidates?: readonly FitCandidate[]; investor?: boolean } = {},
) {
  const read: string[] = [];
  const fit = createFitService({
    investorSubject: {
      investorOrganisationFor: (actor) =>
        Promise.resolve(
          options.investor === false || actor.userId !== actorB.userId
            ? null
            : { investorOrganisationId: INVESTOR_B },
        ),
    },
    eligibility: {
      evaluate: (query) =>
        Promise.resolve({
          context: {} as never,
          results: query.companyIds.map((companyId) => ({
            companyId,
            mandateId: MANDATE,
            // The private company is not this reader's to see.
            reasonCodes:
              companyId === COMPANY_B_PRIVATE
                ? ["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"]
                : [],
          })) as never,
        }),
    },
    inputs: {
      read: (query) => {
        read.push(...query.companyIds);
        return Promise.resolve(
          new Map<string, FitCompanyInputs>(
            query.companyIds.map((id) => [
              id,
              {
                snapshot: snapshot(id === COMPANY_A ? "MATCH" : "NO_MATCH"),
                declared: {},
                name: id === COMPANY_A ? "Sunline Energy" : "Freightly",
                line: null,
              },
            ]),
          ),
        );
      },
    },
    candidates: () => Promise.resolve(options.candidates ?? []),
  });
  const ports = fakePorts({ fit });
  return {
    read,
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

const investorPlan = planFor(actorB, "COMPARISON", [
  {
    kind: "INVESTOR_MANDATE",
    sensitivity: "CONFIDENTIAL",
    investorOrganisationId: INVESTOR_B,
  },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

const call = (name: string, args: Record<string, unknown>) => ({
  callId: "c1",
  name,
  arguments: args,
});

describe("fit tools", () => {
  it("are not offered where fit is not composed", () => {
    const registry = createQToolRegistry(createDefaultQTools(fakePorts({})));
    expect(registry.list().some((r) => r.versionId.startsWith("fit."))).toBe(
      false,
    );
  });

  it("top N ranks only the investor's own candidates, leaving out one they may not see", async () => {
    const { port, read } = tools({
      candidates: [
        { companyId: COMPANY_B_NETWORK, source: "FEED" },
        { companyId: COMPANY_A, source: "REQUEST" },
        { companyId: COMPANY_B_PRIVATE, source: "RELATIONSHIP" },
      ],
    });
    const outcome = await port.execute(
      call("fit_top_candidates", { limit: 3 }),
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = FitTopCandidatesOutputSchema.parse(outcome.result.data);
    expect(data.status).toBe("OK");
    expect(data.comparison?.entries.map((e) => e.name)).toEqual([
      "Sunline Energy",
      "Freightly",
    ]);
    expect(read).not.toContain(COMPANY_B_PRIVATE);
    expect(data.text).toMatch(/^1\. Sunline Energy: /);
    // Words only: no internal value, no percentage.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toMatch(
      /"value"|"score"|confidenceScore|coverage|\d%/,
    );
    // ADR 0059 / autopilot P2: each entry's score out of 10 is the one code
    // computes from its rows, said beside its words; the model is told to
    // repeat it, never to make one.
    for (const entry of data.comparison?.entries ?? []) {
      const score = fitScoreOutOf10(entry.profile);
      expect(data.text).toContain(
        score === null ? `${entry.name}: ` : `${entry.name}: ${score}/10 · `,
      );
    }
    expect(data.guidance).toContain("score out of 10");
    expect(data.guidance).toContain("never a score of your own");
  });

  it("a founder, or anyone without an investor side, gets nothing", async () => {
    const plan = planFor(actorA, "COMPARISON", [
      { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    ]);
    const { port, read } = tools({
      candidates: [{ companyId: COMPANY_A, source: "FEED" }],
    });
    const outcome = await port.execute(
      call("fit_top_candidates", {}),
      contextFor(actorA, plan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    expect((outcome.result.data as { status: string }).status).toBe(
      "NOT_INVESTOR",
    );
    expect(read).toEqual([]);
  });

  it("one company's fit, and a company the reader may not see is not found", async () => {
    const { port } = tools();
    const ok = await port.execute(
      call("fit_profile", { companyId: COMPANY_A }),
      contextFor(actorB, investorPlan),
    );
    if (!ok.result.ok) throw new Error("expected a result");
    expect((ok.result.data as { status: string; name: string }).name).toBe(
      "Sunline Energy",
    );
    const hidden = await port.execute(
      call("fit_profile", { companyId: COMPANY_B_PRIVATE }),
      contextFor(actorB, investorPlan),
    );
    if (!hidden.result.ok) throw new Error("expected a result");
    expect(hidden.result.data).toMatchObject({
      status: "NOT_FOUND",
      profile: null,
      name: null,
    });
  });

  it("is refused without network-visible scope in the plan", async () => {
    const plan = planFor(actorB, "COMPARISON", [
      {
        kind: "INVESTOR_MANDATE",
        sensitivity: "CONFIDENTIAL",
        investorOrganisationId: INVESTOR_B,
      },
    ]);
    const { port, read } = tools({
      candidates: [{ companyId: COMPANY_A, source: "FEED" }],
    });
    const outcome = await port.execute(
      call("fit_top_candidates", {}),
      contextFor(actorB, plan),
    );
    expect(outcome.result.ok).toBe(false);
    expect(read).toEqual([]);
  });
});
