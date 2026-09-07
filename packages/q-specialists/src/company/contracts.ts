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

import type {
  QSpecialistBlockedReason,
  QSpecialistFinding,
} from "../contracts.js";

/**
 * Company Intelligence request and result (CQ-Q-020 §12-§14).
 *
 * The request names a company and a question. It cannot name a table, a
 * tenant, a visibility scope, a sensitivity ceiling or a knowledge scope,
 * because a request that could would be a way to ask for more than the
 * plan permitted — and the plan, not this, is the authority (§12, §46).
 *
 * The result is structured on purpose (§14). A three-thousand-word blob
 * would answer one question once; findings are reusable, checkable, and
 * projectable by the disclosure layer, which is what makes an evidence
 * trail possible at all.
 */

export type CompanyIntelligenceFocus =
  CompanyIntelligenceDimension | "CHANGES" | "RISKS" | "STRENGTHS" | "GAPS";

export type CompanyIntelligenceRequest = {
  readonly company: Extract<QSubjectRef, { kind: "COMPANY" }>;
  /** The person's message, verbatim. DATA, never an instruction. */
  readonly question: string;
  /**
   * Which dimensions the caller wants covered, when it knows. Empty means
   * "whatever the evidence supports" — never "all of them", because a
   * dimension nothing supports must stay a gap rather than be filled.
   */
  readonly focus?: readonly CompanyIntelligenceFocus[] | undefined;
  /**
   * A historical question's instant. Absent means current. Present means
   * the reading as of then, from valid time — and nothing recorded about a
   * later period reaches the answer (§65, §81).
   */
  readonly asOf?: Date | undefined;
};

/** One dimension's evidential standing. No percentage, ever (§40). */
export type CompanyDimensionCoverage = {
  readonly dimension: CompanyIntelligenceDimension;
  readonly coverage: CompanyEvidenceCoverage;
  /** How many authorised facts spoke to it. A count, not a score. */
  readonly supportingFactCount: number;
};

/**
 * Something that materially changed between two recorded readings (§22,
 * §66, §67). Derived from institutional state — a knowledge series — and
 * never from comparing one model answer with another.
 */
export type CompanyMaterialChangeFinding = {
  readonly dimension: CompanyIntelligenceDimension;
  readonly knowledgeKey: string;
  readonly statement: string;
  readonly fromStatement: string | null;
  readonly toStatement: string | null;
  readonly fromValidAt: UtcTimestamp | null;
  readonly toValidAt: UtcTimestamp | null;
  readonly evidenceRefs: readonly QEvidenceRef[];
};

/**
 * An open disagreement travelling with the answer (§20, §64). Both sides
 * or neither: `statements` holds every authorised member, and the
 * specialist never chooses, averages or ranks them.
 */
export type CompanyContradictionFinding = {
  readonly contradictionSetId: string;
  readonly knowledgeKey: string;
  readonly dimension: CompanyIntelligenceDimension;
  readonly statements: readonly string[];
  readonly evidenceRefs: readonly QEvidenceRef[];
};

export type CompanyIntelligenceResult = {
  readonly companyId: string;
  readonly specialistVersion: string;
  /** The information state the findings describe. */
  readonly asOf: UtcTimestamp;
  /**
   * Present when nothing could be produced. The findings array is then
   * empty and `synthesis` is null; a caller renders a plain sentence from
   * the code and never the code itself (§105).
   */
  readonly blocked: QSpecialistBlockedReason | null;
  /**
   * Every finding, typed and evidence-linked. Deterministic findings
   * (contradictions, staleness, gaps from absent knowledge) and validated
   * model findings live in one list because they are the same kind of
   * thing to a reader; `derivation` says which is which for telemetry.
   */
  readonly findings: readonly CompanyFinding[];
  readonly coverage: readonly CompanyDimensionCoverage[];
  readonly materialChanges: readonly CompanyMaterialChangeFinding[];
  readonly contradictions: readonly CompanyContradictionFinding[];
  /**
   * How confident Capital Q is in its own understanding — never how good
   * the company is (§39). Categorical; there is no number to inflate.
   */
  readonly informationConfidence: QConfidenceLevel;
  /**
   * The user-facing text the model wrote, after validation. Q's synthesis
   * layer owns what a person finally reads; this is the specialist's
   * contribution to it, not a message and not a persona (§11, §56).
   */
  readonly synthesis: string | null;
  /** Safe operational record for traces, evals and the developer smoke. */
  readonly telemetry: CompanyIntelligenceTelemetry;
};

export type CompanyFinding = QSpecialistFinding & {
  readonly dimension: CompanyIntelligenceDimension;
  /** DETERMINISTIC: computed from institutional state. MODEL: written, then validated. */
  readonly derivation: "DETERMINISTIC" | "MODEL";
};

/**
 * Counts, codes and timings only (§102). No statement, no excerpt, no
 * fact, no prompt and no model output ever appears here, because a
 * founder-private figure is founder-private in a log line too.
 */
export type CompanyIntelligenceTelemetry = {
  readonly specialistId: string;
  readonly specialistVersion: string;
  readonly promptBundleVersion: string | null;
  readonly providerCode: string | null;
  readonly modelCode: string | null;
  readonly routingPolicyCode: string | null;
  readonly modelCalls: number;
  readonly retrievalCalls: number;
  readonly knowledgeReads: number;
  readonly toolCalls: number;
  readonly factCount: number;
  readonly promptCharacters: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly findingCountsByType: Readonly<Record<string, number>>;
  readonly evidenceRefCount: number;
  readonly contradictionCount: number;
  readonly gapCount: number;
  readonly uncertaintyCount: number;
  readonly staleFactCount: number;
  /** Model findings dropped because a claim or a citation did not hold (§61). */
  readonly rejectedFindingCount: number;
  readonly rejectedCitationCount: number;
};
