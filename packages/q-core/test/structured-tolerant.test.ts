import { describe, expect, it } from "vitest";

import {
  AnalysisCritiqueResultSchema,
  AnalysisCritiqueResultV3Schema,
  AnalysisDocumentResultSchema,
  AnalysisDocumentResultV3Schema,
  createDefaultPromptRegistry,
  JobPlanResultV9Schema,
  JobPlanResultV10Schema,
  normalisePlanV10,
  planKey,
  ResearchFactsResultSchema,
  ResearchFactsResultV2Schema,
} from "../src/index.js";

/**
 * Live 2026-10-24 (batch 5): one model's answers were refused as
 * INVALID_MODEL_OUTPUT on most deep-work calls, never truncated. The kinds
 * of slip below were refused whole before; now they cost nothing or only
 * their own part, and code still clips what it stores.
 */
describe("tolerant deep-work results", () => {
  it("are the active versions", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("JOB_PLAN").definition.version).toBe(14);
    expect(registry.getActive("RESEARCH_PLAN").definition.version).toBe(3);
    expect(registry.getActive("RESEARCH_FACTS").definition.version).toBe(2);
    expect(registry.getActive("ANALYSIS_WRITE").definition.version).toBe(4);
    expect(registry.getActive("ANALYSIS_CRITIQUE").definition.version).toBe(3);
  });

  it("keeps a plan with hyphenated keys and extra keys, normalising every reference", () => {
    const plan = {
      summary: "Research the market and write your plan",
      outcome: "A 12-month plan.",
      prerequisites: [],
      nextActions: [],
      cannot: [],
      firstRead: null,
      steps: [
        {
          key: "Research-Market",
          role: "RESEARCH",
          agentName: "Research",
          goal: "Learn the market",
          tools: ["public_web.search"],
          dependsOn: [],
          why: "Evidence first.",
          evidence: [],
          fallbackFor: null,
        },
        {
          key: "write plan",
          role: "DOCUMENTS",
          goal: "Write the plan",
          tools: ["documents.own.prepare"],
          dependsOn: ["Research-Market"],
          document: {
            operation: "PREPARE",
            kind: "ANALYSIS",
            scope: "GENERAL",
          },
          why: "It is what they asked for.",
          evidence: [],
          fallbackFor: null,
        },
      ],
    };
    expect(JobPlanResultV9Schema.safeParse(plan).success).toBe(false);
    const parsed = JobPlanResultV10Schema.safeParse(plan);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normal = normalisePlanV10(parsed.data);
    expect(normal.steps.map((step) => step.key)).toEqual([
      "research_market",
      "write_plan",
    ]);
    expect(normal.steps[1]?.dependsOn).toEqual(["research_market"]);
    expect(JobPlanResultV9Schema.safeParse(normal).success).toBe(true);
    expect(planKey("123 -- ")).toBe("step");
  });

  it("keeps facts with keys the schema does not use and an unknown kind", () => {
    const facts = {
      facts: [
        {
          statement:
            "Kenya's water vending market was worth KES 18 billion in 2023.",
          figure: "KES 18 billion",
          asOf: "2023",
          source: 2,
          kind: "MARKET_SIZE",
          lane: "MARKET_SIZE",
        },
      ],
      followUps: [
        { lane: "ATM operators / pricing", query: "Majik Water pricing" },
      ],
    };
    expect(ResearchFactsResultSchema.safeParse(facts).success).toBe(false);
    const parsed = ResearchFactsResultV2Schema.safeParse(facts);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.facts[0]?.kind).toBe("FACT");
    expect(parsed.data.facts[0]).not.toHaveProperty("lane");
  });

  it("keeps a long first draft and a long critique", () => {
    const draft = {
      title: "Maji Loop: 12-month growth plan",
      summary: "s".repeat(900),
      sections: [1, 2, 3].map((n) => ({
        heading: `Section ${String(n)}`,
        body: "b".repeat(7_000),
        findings: [],
      })),
      topRecommendations: ["a", "b", "c", "d"],
      gaps: [],
    };
    expect(AnalysisDocumentResultSchema.safeParse(draft).success).toBe(false);
    expect(AnalysisDocumentResultV3Schema.safeParse(draft).success).toBe(true);
    const critique = {
      passes: false,
      score: 61.5,
      issues: [
        {
          kind: "STRUCTURE",
          section: "Recommendations",
          problem: "p".repeat(600),
          fix: "f",
        },
      ],
      strengths: [],
    };
    expect(AnalysisCritiqueResultSchema.safeParse(critique).success).toBe(
      false,
    );
    const parsed = AnalysisCritiqueResultV3Schema.safeParse(critique);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.issues[0]?.kind).toBe("GENERIC");
  });

  // The exact paths q-api logged as refused, 14:56-14:58 UTC on 9ff4a1118.
  it("accepts each path refused live", () => {
    const longKey =
      "research_the_west_africa_logistics_market_and_comparable_seed_rounds_for_the_portfolio";
    const step = (key: string, extra: Record<string, unknown>) => ({
      key,
      role: "RESEARCH",
      goal: "Learn the market",
      tools: ["public_web.search"],
      dependsOn: [],
      why: "Evidence first.",
      evidence: [],
      ...extra,
    });
    const plan = {
      summary: "Review the portfolio",
      outcome: "A review.",
      steps: [
        // steps.0.key (too long, off-format); steps.0.fallbackFor missing
        step(`${longKey} (Phase-1)`, {}),
        // steps.1.dependsOn.0 too_big; steps.1.fallbackFor:invalid_type
        step("Write review", {
          dependsOn: [`${longKey} (Phase-1)`],
          fallbackFor: 0,
        }),
      ],
    };
    expect(JobPlanResultV9Schema.safeParse(plan).success).toBe(false);
    const parsed = JobPlanResultV10Schema.safeParse(plan);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normal = normalisePlanV10(parsed.data);
    expect(normal.steps).toHaveLength(2);
    expect(normal.steps[1]?.dependsOn).toEqual([normal.steps[0]?.key]);
    expect(normal.steps[1]?.fallbackFor).toBeNull();
    expect(JobPlanResultV9Schema.safeParse(normal).success).toBe(true);

    // facts.0.figure too_big; facts.1.kind invalid_value
    const facts = ResearchFactsResultV2Schema.safeParse({
      facts: [
        {
          statement: "a",
          figure: "f".repeat(1_000),
          asOf: null,
          source: 1,
          kind: "FIGURE",
        },
        { statement: "b", figure: null, asOf: null, source: 2, kind: "OTHER" },
      ],
      followUps: [],
    });
    expect(facts.success).toBe(true);
    if (facts.success) {
      expect(facts.data.facts).toHaveLength(2);
      expect(facts.data.facts[0]?.figure).toBeNull();
      expect(facts.data.facts[1]?.kind).toBe("FACT");
    }

    // summary too_big; sections.3.body too_small
    const draft = AnalysisDocumentResultV3Schema.safeParse({
      title: "Portfolio review",
      summary: "s".repeat(4_000),
      sections: [1, 2, 3, 4].map((n) => ({
        heading: `Section ${String(n)}`,
        body: n === 4 ? "" : "body",
      })),
      topRecommendations: ["a"],
      gaps: [],
    });
    expect(draft.success).toBe(true);
    if (draft.success) expect(draft.data.sections[3]?.body).toBe("");
  });

  it("still refuses an answer without its core", () => {
    expect(JobPlanResultV10Schema.safeParse({ summary: "x" }).success).toBe(
      false,
    );
    expect(
      AnalysisDocumentResultV3Schema.safeParse({ title: "x", summary: "y" })
        .success,
    ).toBe(false);
  });
});
