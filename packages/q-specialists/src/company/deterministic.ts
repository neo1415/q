import type {
  QConfidenceLevel,
  QEvidenceRef,
  QSubjectRef,
  UtcTimestamp,
} from "@capital-q/contracts";
import type {
  CompanyEvidenceCoverage,
  CompanyIntelligenceDimension,
} from "@capital-q/q-core";
import { COMPANY_INTELLIGENCE_DIMENSIONS } from "@capital-q/q-core";
import type {
  AuthorisedDispute,
  AuthorisedKnowledge,
} from "@capital-q/q-knowledge";

import type { LabelledFact } from "./assembly.js";
import type {
  CompanyContradictionFinding,
  CompanyDimensionCoverage,
  CompanyFinding,
  CompanyMaterialChangeFinding,
} from "./contracts.js";
import { dimensionForKnowledgeKey } from "./dimensions.js";

/**
 * The findings Capital Q makes without asking a model (CQ-Q-020 §20-§23,
 * §37, §40, §67).
 *
 * Everything here is a statement about institutional state that code can
 * assert, so no model is asked to assert it. That is not caution about
 * cost — it is that these are exactly the statements a fluent model gets
 * subtly wrong in the direction that flatters: choosing the larger of two
 * conflicting numbers, describing a five-month-old balance as current,
 * calling an absence a weakness, or reporting a row's timestamp as a
 * change in the business.
 *
 * Because they are computed, they are also the frame the model is shown
 * and told it may not overturn.
 */

export type DeterministicInput = {
  readonly knowledge: readonly AuthorisedKnowledge[];
  readonly disputes: readonly AuthorisedDispute[];
  /** Knowledge series, newest effective first, for the change comparison. */
  readonly series: ReadonlyMap<string, readonly AuthorisedKnowledge[]>;
  readonly facts: readonly LabelledFact[];
  readonly runId: string;
  readonly subjects: readonly QSubjectRef[];
  readonly sensitivity: CompanyFinding["sensitivity"];
  readonly visibilityScope: CompanyFinding["visibilityScope"];
  readonly validAt: UtcTimestamp;
  readonly findingId: (seed: string) => CompanyFinding["findingId"];
};

function refsOf(known: AuthorisedKnowledge): readonly QEvidenceRef[] {
  return [
    ...known.evidence.map((item): QEvidenceRef => ({
      kind: "EVIDENCE_ITEM",
      evidenceItemId: item.evidenceItemId,
    })),
    ...known.sourceIds.map((sourceId): QEvidenceRef => ({
      kind: "SOURCE",
      sourceId,
    })),
  ];
}

/**
 * Open disagreements, with both sides.
 *
 * The set is reported, never resolved: no side is chosen, nothing is
 * averaged, and the members are listed in the order the query returned
 * them rather than by size or recency, because ordering by either would be
 * a preference expressed as a layout.
 */
export function contradictionFindings(
  input: DeterministicInput,
): readonly CompanyContradictionFinding[] {
  return input.disputes.map((dispute) => ({
    contradictionSetId: dispute.set.id,
    knowledgeKey: dispute.set.knowledgeKey,
    dimension:
      dimensionForKnowledgeKey(dispute.set.knowledgeKey) ?? "FINANCIAL",
    statements: dispute.members.map((member) => member.object.statement),
    evidenceRefs: dispute.members.flatMap((member) => refsOf(member)),
  }));
}

/**
 * Material changes between two recorded readings of the same metric.
 *
 * The comparison is between institutional states, never between two model
 * answers (§67). A reading is a change only when the values actually
 * differ and the periods differ — a correction that restates the same
 * period is a correction, and reporting it as a decline would turn a fixed
 * typo into a business event (§22).
 */
export function materialChangeFindings(
  input: DeterministicInput,
): readonly CompanyMaterialChangeFinding[] {
  const changes: CompanyMaterialChangeFinding[] = [];
  for (const [knowledgeKey, readings] of input.series) {
    if (readings.length < 2) {
      continue;
    }
    const [current, previous] = readings;
    if (current === undefined || previous === undefined) {
      continue;
    }
    const currentFrom = current.object.validFrom ?? current.object.recordedAt;
    const previousFrom =
      previous.object.validFrom ?? previous.object.recordedAt;
    if (
      currentFrom === previousFrom ||
      current.object.statement === previous.object.statement
    ) {
      // Same period, or the same words: a restatement, not a change.
      continue;
    }
    changes.push({
      dimension: dimensionForKnowledgeKey(knowledgeKey) ?? "DESCRIPTION",
      knowledgeKey,
      statement: `${knowledgeKey} changed between the reading effective ${previousFrom} and the reading effective ${currentFrom}.`,
      fromStatement: previous.object.statement,
      toStatement: current.object.statement,
      fromValidAt: previous.object.validFrom,
      toValidAt: current.object.validFrom,
      evidenceRefs: [...refsOf(previous), ...refsOf(current)],
    });
  }
  return changes;
}

/**
 * Evidence coverage per dimension (§40).
 *
 * The best evidence status among the facts that spoke to a dimension, and
 * INSUFFICIENT when none did. INSUFFICIENT says Capital Q has not been
 * shown enough to speak — it is not a low mark, and the vocabulary
 * deliberately offers no number that could be averaged into one.
 */
export function coverageByDimension(
  facts: readonly LabelledFact[],
  findings: readonly CompanyFinding[],
): readonly CompanyDimensionCoverage[] {
  const ranked: readonly CompanyEvidenceCoverage[] = [
    "INSUFFICIENT",
    "SELF_REPORTED",
    "DOCUMENT_SUPPORTED",
    "MULTI_SOURCE_SUPPORTED",
    "EXTERNALLY_VERIFIED",
    "PLATFORM_VERIFIED",
  ];
  const rankOf = (status: string): number => {
    const index = ranked.indexOf(status as CompanyEvidenceCoverage);
    return index === -1 ? 0 : index;
  };
  const coverage: CompanyDimensionCoverage[] = [];
  for (const dimension of COMPANY_INTELLIGENCE_DIMENSIONS) {
    // A dimension is evidenced by the facts mapped to it AND by what the
    // findings about it actually rest on. Facts alone would be wrong: a
    // retrieved passage has no dimension of its own, so a dimension
    // evidenced entirely by documents would report INSUFFICIENT while its
    // findings carried real document support — a coverage map that
    // contradicted the findings beside it.
    const supporting = facts.filter((fact) => fact.dimension === dimension);
    const spoken = findings.filter(
      (finding) => finding.dimension === dimension,
    );
    if (supporting.length === 0 && spoken.length === 0) {
      continue;
    }
    // A gap says a dimension is NOT evidenced, so it establishes that the
    // dimension was looked at without contributing any support to it. A
    // dimension known only by its gaps is reported INSUFFICIENT, which is
    // the honest reading and the one a caller needs to see.
    const about = spoken.filter((finding) => finding.type !== "GAP");
    const best = Math.max(
      0,
      ...supporting.map((fact) => rankOf(fact.fact.evidenceStatus)),
      ...about.map((finding) => rankOf(finding.evidenceStatus)),
    );
    const sources = new Set([
      ...supporting.flatMap((fact) =>
        fact.evidenceRefs.map((ref) => JSON.stringify(ref)),
      ),
      ...about.flatMap((finding) =>
        finding.evidenceRefs.map((ref) => JSON.stringify(ref)),
      ),
    ]).size;
    const index =
      sources > 1 && ranked[best] === "DOCUMENT_SUPPORTED"
        ? ranked.indexOf("MULTI_SOURCE_SUPPORTED")
        : best;
    coverage.push({
      dimension,
      coverage: ranked[index] ?? "INSUFFICIENT",
      supportingFactCount: supporting.length,
    });
  }
  return coverage;
}

/**
 * The findings that follow from state alone: one UNCERTAINTY per open
 * disagreement, one UNCERTAINTY per figure past its useful life, and one
 * GAP per dimension the caller asked about that nothing supports.
 *
 * A gap is produced only for a dimension the question actually reached
 * for. Listing every unpopulated field would bury the material gaps under
 * a checklist, which is the failure §79 names.
 */
export function deterministicFindings(
  input: DeterministicInput,
  requestedDimensions: ReadonlySet<CompanyIntelligenceDimension>,
): readonly CompanyFinding[] {
  const findings: CompanyFinding[] = [];
  const base = {
    runId: input.runId as CompanyFinding["runId"],
    subjects: [...input.subjects],
    sensitivity: input.sensitivity,
    visibilityScope: input.visibilityScope,
    validAt: input.validAt,
    derivation: "DETERMINISTIC" as const,
  };

  for (const dispute of input.disputes) {
    const dimension =
      dimensionForKnowledgeKey(dispute.set.knowledgeKey) ?? "FINANCIAL";
    findings.push({
      ...base,
      findingId: input.findingId(`dispute:${dispute.set.id}`),
      type: "UNCERTAINTY",
      dimension,
      statement: `Authorised sources disagree about ${dispute.set.knowledgeKey} for the same period. ${String(dispute.members.length)} readings are on record and none has been settled; Capital Q does not choose between them.`,
      truthClass: "UNKNOWN",
      evidenceStatus:
        dispute.members[0]?.object.evidenceStatus ?? "NO_EVIDENCE",
      confidence: "CONFLICTING_EVIDENCE",
      evidenceRefs: dispute.members.flatMap((member) => [...refsOf(member)]),
      lifecycleStatus: "CONTRADICTORY",
    });
  }

  for (const known of input.knowledge) {
    if (!known.freshness.stale) {
      continue;
    }
    const dimension =
      dimensionForKnowledgeKey(known.object.knowledgeKey) ?? "FINANCIAL";
    findings.push({
      ...base,
      findingId: input.findingId(`stale:${known.object.id}`),
      type: "UNCERTAINTY",
      dimension,
      // Stale is not false. The statement says what is on record and when,
      // and stops — it never says the figure is wrong, because it is not.
      statement: `The most recent authorised reading of ${known.object.knowledgeKey} is ${String(known.freshness.ageDays ?? 0)} days old, past the ${known.freshness.policyVersion} useful life for this metric. It describes when it was established and may not describe the position now.`,
      truthClass: known.object.truthClass,
      evidenceStatus: known.object.evidenceStatus,
      confidence: "MODERATE",
      evidenceRefs: [...refsOf(known)],
      lifecycleStatus: "STALE",
    });
  }

  const supported = new Set(
    input.facts.flatMap((fact) =>
      fact.dimension === null ? [] : [fact.dimension],
    ),
  );
  for (const dimension of requestedDimensions) {
    if (supported.has(dimension)) {
      continue;
    }
    findings.push({
      ...base,
      findingId: input.findingId(`gap:${dimension}`),
      type: "GAP",
      dimension,
      // A gap is a statement about Capital Q's evidence, not about the
      // company. The wording keeps it that way on purpose.
      statement: `Capital Q holds no authorised understanding of ${dimension.toLowerCase().replace(/_/g, " ")} for this company. This is missing information, not a negative finding.`,
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      confidence: "INSUFFICIENT_EVIDENCE",
      evidenceRefs: [],
    });
  }

  return findings;
}

/**
 * How confident Capital Q is in its own understanding (§39).
 *
 * A statement about the evidence, never about the company. A company with
 * thin evidence is not a weak company; it is a company Capital Q cannot
 * yet speak about confidently, and the two must never be rendered as the
 * same sentence.
 */
export function informationConfidence(
  facts: readonly LabelledFact[],
  disputes: readonly AuthorisedDispute[],
): QConfidenceLevel {
  if (facts.length === 0) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (disputes.length > 0) {
    return "CONFLICTING_EVIDENCE";
  }
  const supported = facts.filter(
    (fact) =>
      fact.fact.evidenceStatus !== "NO_EVIDENCE" &&
      fact.fact.evidenceStatus !== "SELF_REPORTED",
  ).length;
  const stale = facts.filter((fact) => fact.stale).length;
  if (supported === 0) {
    return "LOW";
  }
  if (stale > 0 || supported < 3) {
    return "MODERATE";
  }
  return "HIGH";
}

/**
 * The trusted frame the model is shown (§42, the v2 prompt's
 * `institutionalNotes`).
 *
 * Codes, keys, counts and dates. Never a conflicting value, never a
 * private statement, never a source title — the notes tell the model that
 * a disagreement exists and about what, which is what it needs to avoid
 * resolving one, and nothing further (§102).
 */
export function institutionalNotes(input: {
  readonly disputes: readonly AuthorisedDispute[];
  readonly staleKeys: readonly string[];
  readonly changes: readonly CompanyMaterialChangeFinding[];
  readonly asOf: Date | null;
}): string {
  const lines: string[] = [];
  if (input.asOf !== null) {
    lines.push(
      `- This is a historical question. Answer as at ${input.asOf.toISOString()} using only the readings supplied, which are the readings that were effective then. Nothing about a later period is available to you.`,
    );
  }
  for (const dispute of input.disputes) {
    lines.push(
      `- OPEN DISAGREEMENT on ${dispute.set.knowledgeKey}: ${String(dispute.members.length)} authorised readings of the same period are on record and unsettled. State that they conflict; do not choose, average or prefer one.`,
    );
  }
  for (const key of input.staleKeys) {
    lines.push(
      `- PAST ITS USEFUL LIFE: ${key}. The reading is true of when it was established; do not present it as the current position.`,
    );
  }
  for (const change of input.changes) {
    lines.push(
      `- RECORDED CHANGE in ${change.knowledgeKey} between readings effective ${change.fromValidAt ?? "an earlier date"} and ${change.toValidAt ?? "a later date"}.`,
    );
  }
  return lines.length === 0
    ? "Nothing was established in advance for this request."
    : lines.join("\n");
}
