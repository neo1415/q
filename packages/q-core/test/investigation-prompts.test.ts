import { describe, expect, it } from "vitest";

import {
  ANALYSIS_WRITE_INVESTIGATION_RULE,
  ANALYSIS_WRITE_V4,
  ANALYSIS_WRITE_V5,
  createDefaultPromptRegistry,
  renderPrompt,
  DEFAULT_COMMUNICATION_PROFILE,
  RESEARCH_FACTS_V3,
  RESEARCH_PLAN_V4,
  ResearchFactsResultV3Schema,
  ResearchPlanResultV4Schema,
} from "../src/index.js";

/** Investigation-grade research prompts (owner 2026-10-29). */
describe("investigation prompts", () => {
  it("are the active versions", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("RESEARCH_PLAN").definition.version).toBe(4);
    expect(registry.getActive("RESEARCH_FACTS").definition.version).toBe(3);
    expect(registry.getActive("ANALYSIS_WRITE").definition.version).toBe(5);
    expect(registry.get("RESEARCH_FACTS", 2)?.definition.status).toBe(
      "DEPRECATED",
    );
  });

  it("the planner reads the open questions and what was asked, primary sources first", () => {
    const registry = createDefaultPromptRegistry();
    const rendered = renderPrompt(registry, {
      task: "RESEARCH_PLAN",
      operatingMode: "CONTINUOUS_INTELLIGENCE",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes: "",
      variables: {
        request: "Investigate the Zedland widget payments sector.",
        purpose: "Investigate",
        subject: "Only what the request itself says.",
        today: "2026-10-29",
        gaps: "REGULATION: no primary source yet",
        asked: "zedland widget payments market size",
      },
    });
    const text = rendered.messages.map((one) => one.content).join("\n");
    expect(text).toContain("REGULATION: no primary source yet");
    expect(text).toContain("zedland widget payments market size");
    expect(RESEARCH_PLAN_V4.template).toContain("PRIMARY SOURCES FIRST");
    expect(RESEARCH_PLAN_V4.template).toContain("Never repeat a query");
    // A later round may find nothing new: no questions is a valid answer.
    expect(
      ResearchPlanResultV4Schema.parse({ questions: [], internalQuery: null }),
    ).toEqual({ questions: [], internalQuery: null });
  });

  it("the fact reader labels measure and entity; a slip costs the label, not the fact", () => {
    expect(RESEARCH_FACTS_V3.template).toContain("- measure:");
    const parsed = ResearchFactsResultV3Schema.parse({
      facts: [
        {
          statement: "x",
          figure: "1",
          asOf: null,
          source: 1,
          kind: "FIGURE",
          measure: 7,
        },
      ],
      followUps: [],
    });
    expect(parsed.facts[0]?.measure).toBeNull();
    expect(parsed.facts[0]?.entity).toBeNull();
  });

  it("the writer's investigation report names every section, leaving the cross-check's to code", () => {
    expect(ANALYSIS_WRITE_V5.variables).toBe(ANALYSIS_WRITE_V4.variables);
    expect(ANALYSIS_WRITE_V5.output).toBe(ANALYSIS_WRITE_V4.output);
    for (const heading of [
      "Executive summary",
      "Key developments",
      "Regulatory risks",
      "Competitive landscape",
      "Opportunities",
      "Implications for your thesis",
      "Gaps and next actions",
      "(Capital Q record)",
      "(Q's inference)",
    ]) {
      expect(ANALYSIS_WRITE_INVESTIGATION_RULE).toContain(heading);
    }
    expect(ANALYSIS_WRITE_INVESTIGATION_RULE).toMatch(
      /Do not write Contradictions, What public sources cannot establish, or Sources/u,
    );
    expect(ANALYSIS_WRITE_INVESTIGATION_RULE).toMatch(
      /No confidence percentages/u,
    );
  });
});
