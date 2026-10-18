import {
  UNICORN_PILLAR_IDS,
  type UnicornPotentialDto,
} from "@capital-q/contracts";

/** Synthetic UI fixture only; never written to canonical company data. */
export const syntheticUnicornAssessment: UnicornPotentialDto = {
  status: "SCORED",
  overallScore: 50,
  band: "DEVELOPING",
  confidence: "LOW",
  coverage: 1,
  stage: "SEED",
  methodVersion: "unicorn-potential.v1.0.0",
  inputRulesVersion: "unicorn-inputs.v1",
  assessedAt: "2026-10-17T12:00:00.000Z",
  up: [],
  down: [],
  missing: [],
  momentum: null,
  benchmark: "Comparable benchmark unavailable",
  pillars: UNICORN_PILLAR_IDS.map((id, index) => ({
    id,
    label:
      [
        "Founder quality & founder–market fit",
        "Market opportunity & expansion",
        "Problem intensity & product–market fit",
        "Traction & growth velocity",
        "Business model & unit economics",
        "Defensibility & competitive moat",
        "Distribution & organic influence",
        "Capital strength & investor support",
        "Team & execution",
        "Timing & structural tailwinds",
        "Scalability & operating leverage",
        "Ecosystem position & strategic optionality",
      ][index] ?? id,
    weight: [12, 14, 14, 12, 8, 9, 7, 6, 7, 4, 5, 2][index] ?? 0,
    grade: 2,
    contribution: ([12, 14, 14, 12, 8, 9, 7, 6, 7, 4, 5, 2][index] ?? 0) / 2,
    coverage: 1,
    criteria: (["A", "B"] as const).map((criterion) => ({
      id: criterion,
      label: `Synthetic criterion ${id}${criterion}`,
      state: "OBSERVED",
      grade: 2,
      anchor:
        "Synthetic founder claim for layout verification; not independently verified.",
      sources: [
        {
          id: `synthetic-claim-${id}${criterion}`,
          revision: "synthetic-v1",
          at: "2026-10-17T12:00:00.000Z",
          kind: "CLAIM",
          label: "Synthetic founder statement",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          lifecycleStatus: "CURRENT",
          visibilityScope: "network_visible",
        },
      ],
    })),
  })),
};
