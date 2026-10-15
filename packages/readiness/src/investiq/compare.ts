import type { InvestIQAssessment } from "./contracts.js";
import {
  LEGACY_PRIMARY_PILLAR,
  type LegacyShadowInput,
} from "./legacy-shadow.js";

/**
 * Shadow comparison of one stored readiness-rules/v1 assessment with the
 * InvestIQ shadow result computed from it. Pure; produces difference codes
 * only (no company names, no statements), so a report is safe to share
 * with the lead.
 *
 *   LEGACY_KNOWN_SHADOW_UNKNOWN   v1 shows a non-Unknown status but every
 *                                 line it relied on is excluded here
 *                                 (verification, taxonomy, "not known").
 *   LEGACY_STRONG_SELF_REPORTED   v1 Strong while the strongest admissible
 *                                 evidence is SELF_REPORTED or below.
 *   LEGACY_STRONG_ON_PRESENCE     v1 Strong while nothing is judged
 *                                 (all RECORDED): readiness of records is
 *                                 not business strength.
 *   LEGACY_GAP_SHADOW_OBSERVED    v1 Gap (a missing artefact) while facts
 *                                 are on record: a gap is not a weakness.
 *   CONFLICT_PRESENT              an open contradiction (both agree).
 *   NOT_APPLICABLE_APPLIED        the shadow applied a context N/A rule.
 */
export type ShadowDifference =
  | "LEGACY_KNOWN_SHADOW_UNKNOWN"
  | "LEGACY_STRONG_SELF_REPORTED"
  | "LEGACY_STRONG_ON_PRESENCE"
  | "LEGACY_GAP_SHADOW_OBSERVED"
  | "CONFLICT_PRESENT"
  | "NOT_APPLICABLE_APPLIED";

export type ShadowDimensionComparison = {
  readonly dimension: string;
  readonly legacyPillar: string;
  readonly legacyStatus: string | null;
  readonly observedCriteria: number;
  readonly applicableCriteria: number;
  readonly highestEvidenceStatus: string | null;
  readonly differences: readonly ShadowDifference[];
};

const AT_MOST_SELF_REPORTED = new Set([null, "NO_EVIDENCE", "SELF_REPORTED"]);

export function compareShadowWithLegacy(
  shadowInput: LegacyShadowInput,
  shadow: InvestIQAssessment,
): readonly ShadowDimensionComparison[] {
  const legacyStatus = new Map(
    shadowInput.legacy.pillars.map((p) => [p.pillar, p.status]),
  );
  return shadow.dimensions.map((d) => {
    const pillar = LEGACY_PRIMARY_PILLAR[d.dimension];
    const status = legacyStatus.get(pillar) ?? null;
    const p = d.subscore;
    const differences: ShadowDifference[] = [];
    if (
      status !== null &&
      status !== "UNKNOWN" &&
      p.observedCriteria === 0 &&
      !p.hasUnresolvedConflict
    ) {
      differences.push("LEGACY_KNOWN_SHADOW_UNKNOWN");
    }
    if (
      status === "STRONG" &&
      AT_MOST_SELF_REPORTED.has(p.highestEvidenceStatus)
    ) {
      differences.push("LEGACY_STRONG_SELF_REPORTED");
    }
    if (
      status === "STRONG" &&
      p.counts.strengthIndicated === 0 &&
      p.counts.weaknessEvidenced === 0
    ) {
      differences.push("LEGACY_STRONG_ON_PRESENCE");
    }
    if (status === "GAP" && p.observedCriteria > 0)
      differences.push("LEGACY_GAP_SHADOW_OBSERVED");
    if (p.hasUnresolvedConflict) differences.push("CONFLICT_PRESENT");
    if (p.counts.notApplicable > 0) differences.push("NOT_APPLICABLE_APPLIED");
    return {
      dimension: d.dimension,
      legacyPillar: pillar,
      legacyStatus: status,
      observedCriteria: p.observedCriteria,
      applicableCriteria: p.applicableCriteria,
      highestEvidenceStatus: p.highestEvidenceStatus,
      differences,
    };
  });
}
