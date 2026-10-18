import type {
  BlueprintStep,
  EvidenceStatus,
  QConfidenceLevel,
  QEvidenceRef,
  ReadinessBlueprintDto,
  TruthClass,
} from "@capital-q/contracts";

import type { CheckOutcome, ReadinessAssessment } from "./assess.js";

/**
 * The Capital Readiness Blueprint v1 (PADL #85 Layer 2; ADR 0036): the
 * diagnosis' own open actions, sequenced over the horizon. Code builds the
 * whole skeleton: no step exists that the free diagnosis did not find,
 * and every step names the finding it closes (`closesGapId`). It never
 * restates or withholds diagnosis content.
 *
 * Grounding per step, from the check's own evidence (ADR-001 axes kept
 * apart): the strongest truth class and evidence status on record, and a
 * confidence word chosen by rule, never a number:
 *   CONFLICTING_EVIDENCE  the check is contradicted;
 *   INSUFFICIENT_EVIDENCE nothing on record (truth class UNKNOWN);
 *   HIGH                  verified evidence;
 *   MODERATE              document-supported evidence;
 *   LOW                   only what the founder stated.
 */

const EVIDENCE_RANK: readonly EvidenceStatus[] = [
  "NO_EVIDENCE",
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
];

const TRUTH_RANK: readonly TruthClass[] = [
  "UNKNOWN",
  "Q_INFERENCE",
  "ESTIMATE",
  "USER_CLAIM",
  "VERIFIED",
];

function grounding(outcome: CheckOutcome): {
  readonly evidence: QEvidenceRef[];
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly confidence: QConfidenceLevel;
} {
  const lines = outcome.result.evidence;
  const evidence = lines
    .map((line) => line.ref)
    .filter((ref): ref is QEvidenceRef => ref !== null)
    .slice(0, 10);
  let truthClass: TruthClass = "UNKNOWN";
  let evidenceStatus: EvidenceStatus = "NO_EVIDENCE";
  for (const line of lines) {
    if (
      line.truthClass !== null &&
      TRUTH_RANK.indexOf(line.truthClass) > TRUTH_RANK.indexOf(truthClass)
    ) {
      truthClass = line.truthClass;
    }
    if (
      line.evidenceStatus !== null &&
      EVIDENCE_RANK.indexOf(line.evidenceStatus) >
        EVIDENCE_RANK.indexOf(evidenceStatus)
    ) {
      evidenceStatus = line.evidenceStatus;
    }
  }
  // A step resting on nothing cites nothing and says so (contract rule).
  if (evidence.length === 0) {
    truthClass = "UNKNOWN";
  } else if (truthClass === "UNKNOWN") {
    // A deck or data-room record: the founder's own material.
    truthClass = "USER_CLAIM";
    evidenceStatus =
      evidenceStatus === "NO_EVIDENCE" ? "DOCUMENT_SUPPORTED" : evidenceStatus;
  }
  // VERIFIED is only ever what verified evidence says (DB check mirrors it).
  if (
    truthClass === "VERIFIED" &&
    evidenceStatus !== "EXTERNALLY_VERIFIED" &&
    evidenceStatus !== "PLATFORM_VERIFIED"
  ) {
    truthClass = "USER_CLAIM";
  }
  const confidence: QConfidenceLevel =
    outcome.open === "CONTRADICTED"
      ? "CONFLICTING_EVIDENCE"
      : truthClass === "UNKNOWN"
        ? "INSUFFICIENT_EVIDENCE"
        : evidenceStatus === "PLATFORM_VERIFIED" ||
            evidenceStatus === "EXTERNALLY_VERIFIED"
          ? "HIGH"
          : evidenceStatus === "DOCUMENT_SUPPORTED" ||
              evidenceStatus === "MULTI_SOURCE_SUPPORTED"
            ? "MODERATE"
            : "LOW";
  return { evidence, truthClass, evidenceStatus, confidence };
}

const EFFORT: Readonly<Record<string, BlueprintStep["effort"]>> = {
  FOUNDER: "DAYS",
  WITH_Q: "HOURS",
  EXPERT_SUPPORT: "WEEKS",
};

export function buildBlueprint(input: {
  readonly id: string;
  readonly companyId: string;
  readonly version: number;
  readonly horizonMonths: 3 | 6 | 12;
  readonly assessment: ReadinessAssessment;
  readonly evidenceAsOf: string;
  readonly generatedAt: string;
}): ReadinessBlueprintDto {
  const { assessment } = input;
  const open = assessment.outcomes.filter((outcome) => outcome.open !== null);
  const marked = new Set(
    assessment.actions
      .filter((action) => action.state !== "OPEN")
      .map((action) => action.key),
  );
  const steps: BlueprintStep[] = open
    .filter((outcome) => !marked.has(outcome.rule.action.key))
    .slice(0, 30)
    .map((outcome) => {
      const action = assessment.actions.find(
        (item) => item.key === outcome.rule.action.key,
      );
      return {
        id: outcome.rule.action.key,
        title: action?.title ?? outcome.rule.action.title,
        why: action?.why ?? outcome.rule.action.why,
        closesGapId: outcome.rule.id,
        pillar: outcome.rule.pillar,
        priority: action?.priority ?? "LATER",
        effort: EFFORT[outcome.rule.action.owner] ?? "DAYS",
        executor: outcome.rule.action.owner,
        dependsOn: [],
        doneWhen: outcome.rule.action.doneWhen,
        ...grounding(outcome),
      };
    });

  // Sequencing: NOW in the first month, NEXT through the first quarter,
  // LATER over the rest of the horizon. A step in a later phase depends
  // on nothing by rule; the founder can start anything early.
  const horizonWeeks = Math.min(
    52,
    Math.round((input.horizonMonths * 52) / 12),
  );
  const phases = [
    { label: "This month", priority: "NOW", startsWeek: 0, endsWeek: 4 },
    {
      label: "This quarter",
      priority: "NEXT",
      startsWeek: 4,
      endsWeek: Math.min(13, horizonWeeks),
    },
    {
      label: "Before the horizon",
      priority: "LATER",
      startsWeek: Math.min(13, horizonWeeks - 1),
      endsWeek: horizonWeeks,
    },
  ] as const;
  const sequencing = phases
    .map((phase) => ({
      label: phase.label,
      startsWeek: phase.startsWeek,
      endsWeek: phase.endsWeek,
      stepIds: steps
        .filter((step) => step.priority === phase.priority)
        .map((step) => step.id),
    }))
    .filter(
      (phase) => phase.stepIds.length > 0 && phase.endsWeek > phase.startsWeek,
    );

  return {
    id: input.id,
    companyId: input.companyId,
    version: input.version,
    horizonMonths: input.horizonMonths,
    basis: {
      diagnosisVersion: assessment.rulesVersion,
      evidenceAsOf: input.evidenceAsOf,
      mandateVersions: [],
    },
    roadmap: steps,
    sequencing,
    // Investor-specific plans need named investors' declared criteria;
    // not built in v1, and said so below rather than invented.
    investorPlans: [],
    uncertainty: [
      ...assessment.uncertainty.slice(0, 8),
      "Investor-specific plans aren't in this version of the Blueprint.",
    ].slice(0, 10),
    generatedAt: input.generatedAt,
  };
}
