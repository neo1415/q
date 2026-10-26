import { describe, expect, it } from "vitest";

import {
  NO_RAISE_VIEW,
  UNICORN_PILLAR_IDS,
  UnicornPotentialDtoSchema,
  MODEL_TOOL_RESULT_MAX_CHARS,
  fitScoreOutOf10,
} from "@capital-q/contracts";
import {
  createFitService,
  fitComparisonText,
  type FitCandidate,
  type FitCompanyInputs,
  type RecommendationFeatureSnapshot,
} from "@capital-q/discovery";

import {
  createDefaultQTools,
  createFitTopCandidatesTool,
  createQToolExecutor,
  createQToolRegistry,
  FitTopCandidatesOutputSchema,
  FitProfileOutputSchema,
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
  options: {
    candidates?: readonly FitCandidate[];
    investor?: boolean;
    premium?: () => boolean;
    richSources?: boolean;
    /** Companies whose raise view the fit's own read already carries. */
    carriesRaise?: readonly string[];
  } = {},
) {
  const read: string[] = [];
  const raiseReads: string[][] = [];
  const fit = createFitService({
    unicornPotential: (_actor, ids) =>
      Promise.resolve(
        new Map(
          options.premium?.() === true
            ? ids.map((id) => [id, potentialFixture(options.richSources)])
            : [],
        ),
      ),
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
                ...(options.carriesRaise?.includes(id) === true
                  ? { raiseView: NO_RAISE_VIEW }
                  : {}),
              },
            ]),
          ),
        );
      },
    },
    candidates: () => Promise.resolve(options.candidates ?? []),
  });
  const ports = fakePorts({
    fit,
    ...(options.carriesRaise === undefined
      ? {}
      : {
          companyRaise: {
            raisesFor: (_actor, companyIds) => {
              raiseReads.push([...companyIds]);
              return Promise.resolve(
                new Map(companyIds.map((id) => [id, NO_RAISE_VIEW])),
              );
            },
            raiseFor: () => Promise.resolve(NO_RAISE_VIEW),
          },
        }),
  });
  return {
    read,
    raiseReads,
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

function potentialFixture(richSources = false) {
  const weights = [12, 14, 14, 12, 8, 9, 7, 6, 7, 4, 5, 2];
  return UnicornPotentialDtoSchema.parse({
    status: "SCORED",
    overallScore: 50,
    band: "DEVELOPING",
    confidence: "LOW",
    coverage: 1,
    stage: "SEED",
    methodVersion: "unicorn-potential.v1.0.0",
    inputRulesVersion: "unicorn-potential-inputs.v1",
    assessedAt: "2026-10-17T12:00:00Z",
    pillars: UNICORN_PILLAR_IDS.map((id, i) => ({
      id,
      label: `Pillar ${id}`,
      weight: weights[i],
      grade: 2,
      contribution: (weights[i] ?? 0) / 2,
      coverage: 1,
      criteria: ["A", "B"].map((criterion) => ({
        id: criterion,
        label: `Criterion ${criterion}`,
        state: "OBSERVED",
        grade: 2,
        anchor: "Plausible limited evidence",
        sources: Array.from(
          { length: richSources ? 12 : 1 },
          (_, sourceIndex) => ({
            id: `${id}-${criterion}-${sourceIndex}`,
            revision: "revision-1",
            at: "2026-10-17T12:00:00Z",
            kind: "CLAIM",
            label: richSources
              ? "A long synthetic unit-test claim ".repeat(8).slice(0, 200)
              : "A synthetic unit-test claim",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            visibilityScope: "network_visible",
            lifecycleStatus: "CURRENT",
          }),
        ),
      })),
    })),
    up: [],
    down: [],
    missing: [],
    momentum: null,
    benchmark: "Comparable benchmark unavailable",
  });
}

describe("fit tools", () => {
  it("returns the persisted third assessment and exact calculation inputs only while entitled", async () => {
    let entitled = true;
    const { port } = tools({ premium: () => entitled });
    const invoke = () =>
      port.execute(
        call("fit_profile", { companyId: COMPANY_A }),
        contextFor(actorB, investorPlan),
      );
    const allowed = await invoke();
    expect(allowed.result).toMatchObject({
      ok: true,
      data: { scores: { unicornPotential: potentialFixture() } },
    });
    if (!allowed.result.ok) throw new Error("Expected authorized score");
    expect(JSON.stringify(allowed.result.data).length).toBeLessThan(
      MODEL_TOOL_RESULT_MAX_CHARS,
    );
    const authorized = FitProfileOutputSchema.parse(allowed.result.data);
    expect(authorized.text).toContain("Unicorn Potential: 50/100");
    expect(authorized.guidance).toContain("not a probability");
    expect(authorized.guidance).toContain("disclosure.unicorn-potential");
    expect(authorized.guidance).toContain("act EXPAND");
    expect(authorized.guidance).toContain("client DONE receipt");
    entitled = false;
    const revoked = await invoke();
    if (!revoked.result.ok) throw new Error("Expected denied-feature profile");
    expect(
      FitProfileOutputSchema.parse(revoked.result.data).scores,
    ).not.toHaveProperty("unicornPotential");
    expect(
      FitProfileOutputSchema.parse(revoked.result.data).guidance,
    ).toContain("do not infer or reconstruct a premium score");
    const foreign = await port.execute(
      call("fit_profile", { companyId: COMPANY_B_PRIVATE }),
      contextFor(actorB, investorPlan),
    );
    if (!foreign.result.ok) throw new Error("Expected hidden-company result");
    expect(
      FitProfileOutputSchema.parse(foreign.result.data).scores,
    ).toBeUndefined();
  });

  it("bounds a rich evidence set without changing any calculation input", async () => {
    const { port } = tools({ premium: () => true, richSources: true });
    const result = await port.execute(
      call("fit_profile", { companyId: COMPANY_A }),
      contextFor(actorB, investorPlan),
    );
    expect(result.result.ok).toBe(true);
    if (!result.result.ok)
      throw new Error(result.failureCode ?? "Expected successful fit result");
    const reading = FitProfileOutputSchema.parse(result.result.data);
    expect(JSON.stringify(reading).length).toBeLessThanOrEqual(
      MODEL_TOOL_RESULT_MAX_CHARS,
    );
    expect(
      reading.scores?.unicornPotential?.pillars.map(
        ({ weight, grade, contribution }) => [weight, grade, contribution],
      ),
    ).toEqual(
      potentialFixture().pillars.map(({ weight, grade, contribution }) => [
        weight,
        grade,
        contribution,
      ]),
    );
    expect(reading.guidance).toContain("representative citation");
    expect(reading.scores?.unicornPotential?.overallScore).toBe(50);
  });
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
    // Words only in the fit profile: no internal value, no percentage.
    // The two scores (2026-10-16) are their own typed object beside it.
    const serialised = JSON.stringify({
      ...data,
      comparison:
        data.comparison === null
          ? null
          : {
              ...data.comparison,
              entries: data.comparison.entries.map(
                ({ scores: _scores, ...entry }) => entry,
              ),
            },
    });
    expect(serialised).not.toMatch(
      /"value"|"score"|confidenceScore|coverage|\d%/,
    );
    for (const entry of data.comparison?.entries ?? []) {
      expect(entry.scores?.suitability?.score ?? null).toBe(
        fitScoreOutOf10(entry.profile) === null
          ? null
          : Math.round(Number(fitScoreOutOf10(entry.profile)) * 10),
      );
      // Not assessed is said in words, never as a number.
      expect(entry.scores?.investability.status).toBe("NOT_ASSESSED");
      expect(entry.scores?.investability.score).toBeNull();
    }
    expect(data.text).toContain("Investability not assessed yet");
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
    if (data.comparison === null) throw new Error("expected comparison");
    expect(data.text).toBe(fitComparisonText(data.comparison));
  });

  // Coordinator 2026-10-26 (live trace): the fit already read the raise of
  // the companies it shows; the tool read it again for its cards.
  it("reads the raise only for entries the fit did not already carry it for", async () => {
    const { port, raiseReads } = tools({
      candidates: [
        { companyId: COMPANY_B_NETWORK, source: "FEED" },
        { companyId: COMPANY_A, source: "REQUEST" },
      ],
      carriesRaise: [COMPANY_A],
    });
    const outcome = await port.execute(
      call("fit_top_candidates", { limit: 3 }),
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = FitTopCandidatesOutputSchema.parse(outcome.result.data);
    expect(raiseReads).toEqual([[COMPANY_B_NETWORK]]);
    for (const entry of data.comparison?.entries ?? []) {
      expect(entry.raiseView, entry.name).toEqual(NO_RAISE_VIEW);
    }
  });

  it("named companies are read as one set, each re-checked, labelled as discovered", async () => {
    const { port, read } = tools({
      // Not the candidates: named ids never read the candidate list.
      candidates: [{ companyId: COMPANY_B_NETWORK, source: "RELATIONSHIP" }],
    });
    const outcome = await port.execute(
      call("fit_top_candidates", {
        companyIds: [COMPANY_A, COMPANY_B_PRIVATE],
      }),
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = FitTopCandidatesOutputSchema.parse(outcome.result.data);
    expect(data.comparison?.entries.map((e) => e.name)).toEqual([
      "Sunline Energy",
    ]);
    expect(data.comparison?.entries[0]?.sources).toEqual(["FEED"]);
    expect(read).toEqual([COMPANY_A]);
    // Read from their relationships, they are said as relationships.
    const own = await port.execute(
      call("fit_top_candidates", {
        companyIds: [COMPANY_A],
        source: "RELATIONSHIP",
      }),
      contextFor(actorB, investorPlan),
    );
    if (!own.result.ok) throw new Error("expected a result");
    expect(
      FitTopCandidatesOutputSchema.parse(own.result.data).comparison?.entries[0]
        ?.sources,
    ).toEqual(["RELATIONSHIP"]);
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

  it("returns all ten rich profiles without duplicating their reasons past the tool bound", async () => {
    const baseline = await tools({
      candidates: [{ companyId: COMPANY_A, source: "FEED" }],
    }).port.execute(
      call("fit_top_candidates", { limit: 1 }),
      contextFor(actorB, investorPlan),
    );
    if (!baseline.result.ok) throw new Error("expected canonical comparison");
    const comparison = FitTopCandidatesOutputSchema.parse(
      baseline.result.data,
    ).comparison;
    if (comparison === null || comparison.entries[0] === undefined)
      throw new Error("expected a candidate");
    // The bound under test is the reasons' duplication; scores are added
    // and, if still too large, dropped from the typed entries by the tool.
    const { scores: _scores, ...first } = comparison.entries[0];
    const rich = {
      ...comparison,
      considered: 10,
      entries: Array.from({ length: 10 }, (_, index) => {
        const companyId = `c0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        return {
          ...first,
          companyId,
          name: `Company ${String(index + 1)}`,
          position: index + 1,
          profile: {
            ...first.profile,
            companyId,
            parameters: first.profile.parameters.map((p) => ({
              ...p,
              reason: "Declared evidence remains qualified. ".repeat(3).trim(),
            })),
          },
        };
      }),
    };
    expect(
      JSON.stringify({ comparison: rich, text: fitComparisonText(rich) })
        .length,
    ).toBeGreaterThan(MODEL_TOOL_RESULT_MAX_CHARS);
    expect(
      JSON.stringify({
        comparison: rich,
        text: fitComparisonText(rich, { summaryOnly: true }),
      }).length,
    ).toBeLessThan(MODEL_TOOL_RESULT_MAX_CHARS - 1_000);
    const ports = fakePorts({
      fit: {
        profiles: () => Promise.resolve({ kind: "NO_MANDATE" }),
        compare: () => Promise.resolve({ kind: "NO_MANDATE" }),
        top: () => Promise.resolve({ kind: "OK", comparison: rich }),
      },
    });
    const definition = createFitTopCandidatesTool(ports);
    const oldPort = createQToolExecutor({
      registry: createQToolRegistry([
        {
          ...definition,
          execute: async (input, context, authorization) => ({
            ...FitTopCandidatesOutputSchema.parse(
              await definition.execute(input, context, authorization),
            ),
            text: fitComparisonText(rich),
          }),
        },
      ]),
    });
    const old = await oldPort.execute(
      call("fit_top_candidates", { limit: 10 }),
      contextFor(actorB, investorPlan),
    );
    expect(old.result.ok).toBe(false);
    expect(old.failureCode).toBe("RESULT_TOO_LARGE");
    const port = createQToolExecutor({
      registry: createQToolRegistry([definition]),
    });
    const outcome = await port.execute(
      call("fit_top_candidates", { limit: 10 }),
      contextFor(actorB, investorPlan),
    );
    if (!outcome.result.ok)
      expect(outcome.failureCode).toBe("RESULT_TOO_LARGE");
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok)
      throw new Error(outcome.failureCode ?? "expected comparison");
    const data = FitTopCandidatesOutputSchema.parse(outcome.result.data);
    expect(data.comparison).toEqual(rich);
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(
      MODEL_TOOL_RESULT_MAX_CHARS,
    );
    for (const entry of rich.entries) {
      const score = fitScoreOutOf10(entry.profile);
      expect(data.text).toContain(
        score === null ? `${entry.name}: ` : `${entry.name}: ${score}/10`,
      );
    }
    expect(data.text).toContain("Unknown never counts against a company");
    const oversized = {
      ...rich,
      entries: rich.entries.map((entry) => ({
        ...entry,
        profile: {
          ...entry.profile,
          parameters: entry.profile.parameters.map((p) => ({
            ...p,
            reason: "Declared evidence remains qualified. ".repeat(5).trim(),
          })),
        },
      })),
    };
    const oversizedPort = createQToolExecutor({
      registry: createQToolRegistry([
        createFitTopCandidatesTool(
          fakePorts({
            fit: {
              profiles: () => Promise.resolve({ kind: "NO_MANDATE" }),
              compare: () => Promise.resolve({ kind: "NO_MANDATE" }),
              top: () => Promise.resolve({ kind: "OK", comparison: oversized }),
            },
          }),
        ),
      ]),
    });
    const refused = await oversizedPort.execute(
      call("fit_top_candidates", { limit: 10 }),
      contextFor(actorB, investorPlan),
    );
    expect(refused.result.ok).toBe(false);
    expect(refused.failureCode).toBe("RESULT_TOO_LARGE");
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
