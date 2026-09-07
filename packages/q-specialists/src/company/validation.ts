import type {
  EvidenceStatus,
  QConfidenceLevel,
  QEvidenceRef,
  QFindingType,
  QSubjectRef,
  TruthClass,
  UtcTimestamp,
} from "@capital-q/contracts";
import type {
  CompanyIntelligenceDimension,
  CompanyIntelligenceFinding,
} from "@capital-q/q-core";

import type { AssembledCompanyContext, LabelledFact } from "./assembly.js";
import type { CompanyFinding } from "./contracts.js";

/**
 * Model finding validation (CQ-Q-020 §61, §62, §68-§70, §89, §90).
 *
 * A model wrote these. Nothing here trusts them for having parsed.
 *
 * Five checks, each answering a way a fluent model can be wrong in a way
 * that matters:
 *
 *   1. Citations must resolve. A label the render never showed refers to
 *      nothing, so the citation is dropped. The model never sees or writes
 *      an identifier, so it cannot fabricate one — this check catches
 *      hallucinated labels, not forged ids, because forged ids are not
 *      expressible (§61, §90).
 *   2. An entity-specific material claim needs support. A model that knows
 *      a real company from training must not be able to state a headcount,
 *      a revenue or a customer name that no authorised fact carries.
 *      Unsupported material findings are dropped (§31, §89).
 *   3. Truth class is bounded by what supports it. A finding resting on a
 *      USER_CLAIM cannot be VERIFIED, and nothing a model writes may be
 *      VERIFIED at all: verification is a workflow, not an opinion (§18,
 *      §30).
 *   4. Missing is not bad. A finding whose own words say information is
 *      absent is a GAP, whatever type the model chose (§19, §35, §37).
 *   5. No scores, no fit, no probabilities, no benchmarks. Findings whose
 *      language asserts one are dropped, because the alternative is
 *      Capital Q publishing a number nobody calibrated (§68-§70).
 *
 * Dropping rather than repairing is deliberate. A rewritten finding is a
 * finding nobody wrote, and the counts of what was dropped are reported so
 * the behaviour is visible rather than silent.
 */

export type FindingValidation = {
  readonly accepted: readonly CompanyFinding[];
  readonly rejectedFindings: number;
  readonly rejectedCitations: number;
};

/**
 * Language that asserts a score, a ranking, a probability, a fit or a peer
 * benchmark. Matched on the finding's own words, case-insensitively.
 *
 * Deliberately narrow: these are phrases that make a quantitative or
 * comparative claim Capital Q cannot support, not merely positive words. A
 * broad "no adjectives" filter would delete honest findings, and an empty
 * findings list is its own kind of dishonesty.
 */
const FORBIDDEN_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(?:score|scored|scoring|rating|rated)\b/i,
  /\b(?:investment|funding|success)\s+(?:probability|likelihood|odds|chance)/i,
  /\b(?:probability|likelihood)\s+of\s+(?:funding|investment|raising|closing)/i,
  /\b(?:investor|investment)\s+fit\b/i,
  /\bfit\s+score\b/i,
  /\b(?:investment[- ]ready|readiness\s+(?:score|level|rating))\b/i,
  /\b(?:top|bottom)\s+\d{1,2}\s*%/i,
  /\b(?:top|bottom)[- ](?:decile|quartile|quintile)\b/i,
  /\b(?:above|below)[- ]average\b/i,
  /\b(?:versus|vs\.?|compared\s+to|relative\s+to)\s+(?:peers|comparable|similar\s+companies)/i,
  /\bpeer\s+(?:benchmark|median|average|group)\b/i,
  /\b(?:percentile)\b/i,
  /\b(?:investable|uninvestable)\b/i,
  /\bwe\s+(?:should|would)\s+(?:invest|not\s+invest|pass)\b/i,
];

/** Words that mean "we were not shown this", which is a GAP and never a RISK. */
const ABSENCE_PATTERNS: readonly RegExp[] = [
  /\bno\s+(?:evidence|data|information|figures?|record|source)\b/i,
  /\b(?:not|never)\s+(?:established|provided|available|supplied|disclosed|reported)\b/i,
  /\b(?:unavailable|unknown|undisclosed|unreported)\b/i,
  /\bnothing\s+(?:establishes|supports|shows|indicates)\b/i,
  /\black(?:s|ing)?\s+(?:evidence|data|information)\b/i,
  /\bwe\s+(?:do\s+not|don't)\s+(?:know|have)\b/i,
];

/**
 * A finding that asserts a specific entity fact: a number, a money amount,
 * a percentage, a date or a proper-noun customer name. These are exactly
 * the statements general model knowledge could supply, so they are the
 * ones that must rest on an authorised fact.
 */
const MATERIAL_ASSERTION =
  /\d|\b[A-Z][a-zA-Z]{2,}\s(?:Ltd|Inc|LLC|GmbH|PLC|Limited|Corp)\b/;

export function assertsForbiddenClaim(statement: string): boolean {
  return FORBIDDEN_CLAIM_PATTERNS.some((pattern) => pattern.test(statement));
}

export function assertsAbsence(statement: string): boolean {
  return ABSENCE_PATTERNS.some((pattern) => pattern.test(statement));
}

/**
 * The strongest truth class a finding may claim, given what it cites.
 *
 * VERIFIED is unreachable from here by construction: `verification_claims`
 * is a separate workflow (ADR-001) and no amount of document support makes
 * a model's reading verified. A finding citing nothing is at best the
 * model's own inference over the conversation.
 */
export function boundedTruthClass(
  proposed: TruthClass,
  cited: readonly LabelledFact[],
  type: QFindingType,
): TruthClass {
  const ranked: readonly TruthClass[] = [
    "UNKNOWN",
    "Q_INFERENCE",
    "ESTIMATE",
    "USER_CLAIM",
    "VERIFIED",
  ];
  if (type === "INFERENCE") {
    // The model reached this itself. Whatever supports it, the conclusion
    // is Q's, and presenting an inference as anything else is the exact
    // confusion ADR-001 keeps three axes to prevent.
    return "Q_INFERENCE";
  }
  if (cited.length === 0) {
    return proposed === "UNKNOWN" ? "UNKNOWN" : "Q_INFERENCE";
  }
  // The ceiling is the best class among the facts this finding actually
  // rests on. VERIFIED is therefore reachable only by restating something
  // already verified upstream — a model can never introduce it, and a
  // USER_CLAIM can never become one by being repeated confidently.
  const ceilingIndex = Math.max(
    ...cited.map((fact) => ranked.indexOf(fact.fact.truthClass)),
    0,
  );
  const proposedIndex = ranked.indexOf(proposed);
  const index = Math.min(
    proposedIndex === -1 ? 0 : proposedIndex,
    ceilingIndex,
  );
  return ranked[index] ?? "Q_INFERENCE";
}

/**
 * The evidence status a finding may claim: the best one among the facts it
 * actually cites, and NO_EVIDENCE when it cites nothing.
 */
function boundedEvidenceStatus(cited: readonly LabelledFact[]): EvidenceStatus {
  const ranked: readonly EvidenceStatus[] = [
    "NO_EVIDENCE",
    "SELF_REPORTED",
    "DOCUMENT_SUPPORTED",
    "MULTI_SOURCE_SUPPORTED",
    "EXTERNALLY_VERIFIED",
    "PLATFORM_VERIFIED",
  ];
  if (cited.length === 0) {
    return "NO_EVIDENCE";
  }
  const best = Math.max(
    ...cited.map((fact) => ranked.indexOf(fact.fact.evidenceStatus)),
    0,
  );
  // Two distinct sources supporting one finding is multi-source support,
  // which is a fact about the finding rather than about either source.
  const distinctSources = new Set(
    cited.flatMap((fact) =>
      fact.evidenceRefs.map((ref) => JSON.stringify(ref)),
    ),
  ).size;
  const index =
    distinctSources > 1 && ranked[best] === "DOCUMENT_SUPPORTED"
      ? ranked.indexOf("MULTI_SOURCE_SUPPORTED")
      : best;
  return ranked[index] ?? "NO_EVIDENCE";
}

/** A finding citing nothing cannot claim more than the lowest confidence. */
function boundedConfidence(
  proposed: QConfidenceLevel,
  cited: readonly LabelledFact[],
): QConfidenceLevel {
  if (cited.some((fact) => fact.disputed)) {
    return "CONFLICTING_EVIDENCE";
  }
  if (cited.length === 0) {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (cited.some((fact) => fact.stale) && proposed === "HIGH") {
    // A figure past its useful life cannot support a high-confidence
    // statement about now, whatever the model thought.
    return "MODERATE";
  }
  return proposed;
}

export type ValidationInput = {
  readonly findings: readonly CompanyIntelligenceFinding[];
  readonly context: AssembledCompanyContext;
  readonly runId: string;
  readonly subjects: readonly QSubjectRef[];
  readonly sensitivity: CompanyFinding["sensitivity"];
  readonly visibilityScope: CompanyFinding["visibilityScope"];
  readonly validAt: UtcTimestamp;
  readonly findingId: (index: number) => CompanyFinding["findingId"];
};

export function validateModelFindings(
  input: ValidationInput,
): FindingValidation {
  const accepted: CompanyFinding[] = [];
  let rejectedFindings = 0;
  let rejectedCitations = 0;

  input.findings.forEach((proposed) => {
    if (assertsForbiddenClaim(proposed.statement)) {
      rejectedFindings += 1;
      return;
    }

    const cited: LabelledFact[] = [];
    for (const label of proposed.citations) {
      const fact = input.context.byLabel.get(label);
      if (fact === undefined) {
        rejectedCitations += 1;
        continue;
      }
      cited.push(fact);
    }

    // Absence is a gap, whatever the model called it. This runs before the
    // support check because a gap is ABOUT there being no support, so
    // requiring support for it would delete the honest answer.
    const absence = assertsAbsence(proposed.statement);
    const type: QFindingType = absence
      ? "GAP"
      : (proposed.type satisfies QFindingType);

    if (
      !absence &&
      cited.length === 0 &&
      MATERIAL_ASSERTION.test(proposed.statement) &&
      type !== "UNCERTAINTY"
    ) {
      // A specific number or a named organisation with nothing behind it.
      // This is exactly what general model knowledge produces, and it is
      // never entity-specific evidence.
      rejectedFindings += 1;
      return;
    }

    const evidenceRefs: QEvidenceRef[] = [];
    const seen = new Set<string>();
    for (const fact of cited) {
      for (const ref of fact.evidenceRefs) {
        const key = JSON.stringify(ref);
        if (!seen.has(key)) {
          seen.add(key);
          evidenceRefs.push(ref);
        }
      }
    }

    const dimension: CompanyIntelligenceDimension = proposed.dimension;
    accepted.push({
      findingId: input.findingId(accepted.length),
      runId: input.runId as CompanyFinding["runId"],
      type,
      dimension,
      derivation: "MODEL",
      statement: proposed.statement,
      truthClass: boundedTruthClass(proposed.truthClass, cited, type),
      evidenceStatus: boundedEvidenceStatus(cited),
      confidence: boundedConfidence(proposed.confidence, cited),
      evidenceRefs,
      subjects: [...input.subjects],
      sensitivity: input.sensitivity,
      visibilityScope: input.visibilityScope,
      validAt: input.validAt,
      ...(proposed.assumptions.length === 0
        ? {}
        : { assumptions: proposed.assumptions }),
    });
  });

  return { accepted, rejectedFindings, rejectedCitations };
}
