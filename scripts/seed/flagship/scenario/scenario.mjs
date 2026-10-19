// Illustrative high-growth scenarios: synthetic, typed inputs run through the
// UNCHANGED deterministic Unicorn Potential and Investability scorers
// (packages/readiness public entrypoint, built dist). Offline and pure: no
// database, no network, no provider call, and an explicit clock.
//
// Every synthetic source is USER_CLAIM + SELF_REPORTED: the most conservative
// status the Unicorn Potential rubric still grades. Nothing is ever marked
// EXTERNALLY_VERIFIED, PLATFORM_VERIFIED or MULTI_SOURCE_SUPPORTED, so no
// criterion can reach grade 4 and the ceiling is 75/100 (see README).

import {
  assessInvestability,
  assessUnicornPotential,
  UNICORN_PILLARS,
} from "../../../../packages/readiness/dist/index.js";

import capitalQ from "./scenarios/capital-q.mjs";
import kuuza from "./scenarios/kuuza.mjs";
import songscribe from "./scenarios/songscribe.mjs";
import zinoAviation from "./scenarios/zino-aviation.mjs";

export const SCENARIO_ID = "illustrative-high-growth-v1";
export const SCENARIO_LABEL =
  "Illustrative high-growth scenario — synthetic evidence";
export const BANNER = `${SCENARIO_LABEL}. Not the company's actual performance.`;
export const METADATA = Object.freeze({
  synthetic: true,
  scenario: SCENARIO_ID,
  label: SCENARIO_LABEL,
});
/** Fixed clock: results are reproducible byte for byte. */
export const AS_OF = "2026-10-18T00:00:00.000Z";
export const ASSERTED_AT = "2026-10-15T09:00:00.000Z";

export const SCENARIOS = Object.freeze(
  Object.fromEntries(
    [kuuza, songscribe, capitalQ, zinoAviation]
      .filter((s) => s !== null)
      .map((s) => [s.slug, s]),
  ),
);

const base = (id) => ({
  id,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  lifecycleStatus: "CURRENT",
  visibilityScope: "network_visible",
  assertedAt: ASSERTED_AT,
  validFrom: null,
  validTo: null,
  revisionId: `${id}.r1`,
  revisionNumber: 1,
});

/** InvestabilityInputs (packages/readiness/src/investability/inputs.ts) + metadata. */
export function buildInputs(scenario) {
  return {
    companyId: `synthetic-${scenario.slug}`,
    stageCode: scenario.stageCode,
    sectorCodes: scenario.sectorCodes,
    businessModelCodes: scenario.businessModelCodes,
    profile: {
      listed: true,
      description: true,
      website: true,
      updatedAt: ASSERTED_AT,
    },
    // Verification badges are platform decisions; a scenario never fakes them.
    verification: { organisation: false, domain: false, decidedAt: null },
    founders: scenario.founders.map((f) => ({
      id: f.id,
      title: f.title,
      detail: f.detail,
      recordedAt: ASSERTED_AT,
      documentSupported: false,
      visibilityScope: "network_visible",
      metadata: { ...METADATA, criterion: f.criterion },
    })),
    claims: [
      ...scenario.claims.map((c) => ({
        ...base(c.id),
        claimType: "synthetic_scenario",
        claimKey: c.claimKey,
        statement: c.statement,
        structuredValue: null,
        metadata: { ...METADATA, criterion: c.criterion },
      })),
      ...scenario.structured.map((c) => ({
        ...base(c.id),
        claimType: "synthetic_scenario_metric",
        claimKey: c.claimKey,
        statement: c.statement,
        structuredValue: c.value,
        metadata: { ...METADATA, criterion: "structured" },
      })),
    ],
    deck: null,
    pitch: null,
  };
}

const sourceIds = (criterion) => [
  ...new Set(criterion.sources.map((s) => s.id)),
];

export function runScenario(slug) {
  const scenario = SCENARIOS[slug];
  if (scenario === undefined) throw new Error(`Unknown scenario ${slug}`);
  const inputs = buildInputs(scenario);
  const up = assessUnicornPotential(inputs, AS_OF);
  const inv = assessInvestability(inputs, AS_OF);
  const v = up.view;
  const result = {
    metadata: METADATA,
    company: scenario.company,
    asOf: AS_OF,
    unicornPotential: {
      status: v.status,
      overallScore: v.overallScore,
      band: v.band,
      confidence: v.confidence,
      coverage: v.coverage,
      stage: v.stage,
      methodVersion: v.methodVersion,
      inputRulesVersion: v.inputRulesVersion,
      basisHash: up.basisHash,
      pillars: v.pillars.map((p) => ({
        id: p.id,
        label: p.label,
        weight: p.weight,
        grade: p.grade,
        contribution: p.contribution,
        coverage: p.coverage,
        criteria: p.criteria.map((c) => ({
          id: `${p.id}.${c.id}`,
          label: c.label,
          state: c.state,
          grade: c.grade,
          anchor: c.anchor,
          sourceIds: sourceIds(c),
        })),
      })),
      up: v.up,
      down: v.down,
      missing: v.missing,
      rulesFired: up.observations.map(
        (o) =>
          `${o.pillar}.${o.criterion} g${o.grade} ${o.source.id} ${o.rule}`,
      ),
    },
    investability: {
      note: "Reported separately. Same synthetic inputs, unchanged investor-facing Investability scorer.",
      basisHash: inv.basisHash,
      view: inv.view,
    },
  };
  return {
    inputs: {
      metadata: METADATA,
      company: scenario.company,
      asOf: AS_OF,
      stageNote: scenario.stageNote,
      inputs,
    },
    result,
  };
}

export const CRITERIA = UNICORN_PILLARS.flatMap((p) =>
  p.criteria.map((c, i) => ({
    id: `${p.id}.${i === 0 ? "A" : "B"}`,
    pillar: p.label,
    label: c.label,
    gap: c.gap,
  })),
);
