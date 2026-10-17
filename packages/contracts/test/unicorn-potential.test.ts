import { describe, expect, it } from "vitest";
import {
  UnicornCriterionSchema,
  UnicornPotentialDtoSchema,
  UnicornSourceSchema,
} from "../src/http/unicorn-potential.js";

const source = {
  id: "claim:one",
  revision: "1",
  at: "2026-10-17T12:00:00.000Z",
  kind: "CLAIM",
  label: "Dated claim",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  visibilityScope: "network_visible",
  lifecycleStatus: "CURRENT",
};
const unknown = {
  status: "NOT_ASSESSED",
  overallScore: null,
  band: null,
  confidence: "LOW",
  coverage: 0,
  stage: null,
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-inputs.v1",
  assessedAt: null,
  pillars: [],
  up: [],
  down: [],
  missing: [],
  momentum: null,
  benchmark: "Comparable benchmark unavailable",
};
describe("Unicorn Potential trust boundary", () => {
  it("rejects founder-private or relationship-only source lineage", () => {
    expect(UnicornSourceSchema.safeParse(source).success).toBe(true);
    for (const visibilityScope of [
      "founder_private",
      "relationship_shared",
      "investor_private",
    ])
      expect(
        UnicornSourceSchema.safeParse({ ...source, visibilityScope }).success,
      ).toBe(false);
  });
  it("requires real lineage for an observed grade and no grade for unknown", () => {
    const criterion = {
      id: "A",
      label: "Growth",
      state: "OBSERVED",
      grade: 3,
      anchor: "Dated growth",
      sources: [source],
    };
    expect(UnicornCriterionSchema.safeParse(criterion).success).toBe(true);
    expect(
      UnicornCriterionSchema.safeParse({ ...criterion, sources: [] }).success,
    ).toBe(false);
    expect(
      UnicornCriterionSchema.safeParse({ ...criterion, state: "UNKNOWN" })
        .success,
    ).toBe(false);
  });
  it("preserves unknown as null, never a fabricated zero", () => {
    expect(UnicornPotentialDtoSchema.safeParse(unknown).success).toBe(true);
    expect(
      UnicornPotentialDtoSchema.safeParse({ ...unknown, overallScore: 0 })
        .success,
    ).toBe(false);
  });
  it("rejects a reported score without required pillars and coverage", () => {
    expect(
      UnicornPotentialDtoSchema.safeParse({
        ...unknown,
        status: "SCORED",
        overallScore: 80,
        band: "EXCEPTIONAL_SIGNALS",
        stage: "SEED",
        coverage: 1,
      }).success,
    ).toBe(false);
  });
});
