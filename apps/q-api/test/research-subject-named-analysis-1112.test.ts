import { describe, expect, it } from "vitest";

import type { BoundStep } from "@capital-q/q-orchestrator";

import { diligenceSubjectFor } from "../src/composition/workforce/jobs.js";

/**
 * Live 12 Nov (job 072918f2): "Prepare an investment plan for Ajopot…"
 * planned a research step and a named-company analysis waiting on it. Only
 * a *diligence* analysis bound its company to the research, so the search
 * went out unanchored ("ajopot market size growth") and returned namesakes
 * (Ajovy, AJO, Ajaokuta) and noise. Any analysis of one named company now
 * makes the research about that company.
 */
const AJOPOT = "8a1f0c52-3b8e-4d7a-9a51-0c2f6e7d1b44";

const step = (
  key: string,
  dependsOn: string[],
  document?: BoundStep["document"],
): BoundStep =>
  ({
    key,
    role: document === undefined ? "RESEARCH" : "ANALYST",
    agentName: null,
    goal: key,
    tools: [],
    dependsOn,
    why: "",
    ...(document === undefined ? {} : { document }),
  }) as unknown as BoundStep;

describe("the company a research step researches", () => {
  it("is the named company of any analysis that waits on it", () => {
    const steps = [
      step("research_ajopot", []),
      step("prepare_ajopot_analysis", ["research_ajopot"], {
        operation: "PREPARE",
        kind: "ANALYSIS",
        scope: "NAMED_COMPANY",
        companyId: AJOPOT,
      }),
    ];
    expect(diligenceSubjectFor("research_ajopot", steps)).toEqual({
      companyId: AJOPOT,
    });
  });

  it("still the diligence company; none for a general or own analysis, or one not waiting on it", () => {
    expect(
      diligenceSubjectFor("r", [
        step("r", []),
        step("d", ["r"], {
          operation: "PREPARE",
          kind: "ANALYSIS",
          scope: "NAMED_COMPANY",
          companyId: AJOPOT,
          profile: "DILIGENCE",
        }),
      ]),
    ).toEqual({ companyId: AJOPOT });
    expect(
      diligenceSubjectFor("r", [
        step("r", []),
        step("g", ["r"], {
          operation: "PREPARE",
          kind: "ANALYSIS",
          scope: "GENERAL",
        }),
      ]),
    ).toBeNull();
    expect(
      diligenceSubjectFor("r", [
        step("r", []),
        step("n", [], {
          operation: "PREPARE",
          kind: "ANALYSIS",
          scope: "NAMED_COMPANY",
          companyId: AJOPOT,
        }),
      ]),
    ).toBeNull();
  });
});
