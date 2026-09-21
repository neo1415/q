import { randomUUID } from "node:crypto";

import {
  QFindingIdSchema,
  QResultBlocksSchema,
  type QConfidenceLevel,
  type QFindingType,
  type EvidenceStatus,
  type QResultBlock,
  type QSubjectRef,
  type TruthClass,
} from "@capital-q/contracts";

/**
 * What the analyst already produced, as blocks a client can act on
 * (QX-002/003 §C1-§C2).
 *
 * The analyst schema has carried this structure since it was written —
 * "the rest is structure the runtime can check and later surface as
 * result blocks" — and nothing surfaced it. The answer travelled as prose
 * and the findings, the gaps and the questions Q wanted to ask were
 * dropped on the floor. This is that projection, and it invents nothing:
 * every block below is a field the model already filled or a subject the
 * server already authorised for the run.
 *
 * Three rules.
 *
 * **Nothing is fabricated to make a card appear.** A run with no findings
 * produces no finding blocks. A run about no subject produces no
 * reference. The absence of a block is information.
 *
 * **Subjects come from the run, never from the model.** A COMPANY_REFERENCE
 * names the company the run was already authorised against. A model cannot
 * cause a reference to a company by mentioning one, because it is not
 * consulted about which subjects exist.
 *
 * **No identifier travels that the person could not already resolve.**
 * Evidence references are deliberately absent: a reference is only ids,
 * and whether somebody may see the document behind one is disclosure's
 * decision at render time (the QX-001 finding). Findings carry their own
 * evidence refs in the contract, so they are emitted with an empty list
 * rather than with ids the browser has no business holding.
 */

/** The fields of the analyst result this projection reads. */
export type AnalystResultLike = {
  readonly findings?:
    | readonly {
        readonly statement: string;
        readonly type?: string | undefined;
        readonly confidence?: string | undefined;
        readonly truthClass?: string | undefined;
        readonly evidenceStatus?: string | undefined;
      }[]
    | undefined;
  readonly missingEvidence?: readonly string[] | undefined;
  readonly contradictions?: readonly string[] | undefined;
  readonly clarifyingQuestions?:
    readonly { readonly question: string }[] | undefined;
};

const FINDING_TYPES = new Set<string>([
  "FACT",
  "OBSERVATION",
  "INFERENCE",
  "RISK",
  "STRENGTH",
  "GAP",
  "RECOMMENDATION",
  "UNCERTAINTY",
]);

const TRUTH_CLASSES = new Set<string>([
  "VERIFIED",
  "USER_CLAIM",
  "ESTIMATE",
  "Q_INFERENCE",
  "UNKNOWN",
]);

const EVIDENCE_STATUSES = new Set<string>([
  "NO_EVIDENCE",
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
  "EXTERNALLY_VERIFIED",
  "PLATFORM_VERIFIED",
]);

const CONFIDENCE_LEVELS = new Set<string>([
  "HIGH",
  "MODERATE",
  "LOW",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
]);

/**
 * The contract refuses an uncertainty claiming HIGH, which is the right
 * refusal: a block whose whole content is "this was not established"
 * cannot also be certain. Its three levels say exactly what the analyst
 * meant — nothing was found, or two things disagree — so each list maps
 * to the one that is true of it rather than to a generic "low".
 */
const NOT_ESTABLISHED = "INSUFFICIENT_EVIDENCE" as const;
const DISAGREES = "CONFLICTING_EVIDENCE" as const;

/**
 * A reference block for each subject the run was authorised against.
 *
 * Only the two kinds a client can currently do anything with. A
 * relationship, a capital objective, a document or a user has no card and
 * no action, so emitting one would be a rectangle that does nothing.
 */
function subjectBlocks(
  subjects: readonly QSubjectRef[],
): readonly QResultBlock[] {
  return subjects.flatMap((subject): readonly QResultBlock[] => {
    switch (subject.kind) {
      case "COMPANY":
        return [{ kind: "COMPANY_REFERENCE", companyId: subject.companyId }];
      case "INVESTOR_ORGANISATION":
        return [
          {
            kind: "INVESTOR_REFERENCE",
            investorOrganisationId: subject.investorOrganisationId,
          },
        ];
      // A relationship, a capital objective, a document, a person or an
      // organisation has no card and no action, so a reference to one
      // would be a rectangle that does nothing.
      case "RELATIONSHIP":
      case "CAPITAL_OBJECTIVE":
      case "DOCUMENT":
      case "USER":
      case "ORGANISATION":
        return [];
    }
  });
}

export function analystResultBlocks(input: {
  readonly result: AnalystResultLike;
  readonly subjects: readonly QSubjectRef[];
  /** Overridable so a test can pin the ids it asserts on. */
  readonly findingId?: ((index: number) => string) | undefined;
}): QResultBlock[] | undefined {
  const idFor = input.findingId ?? (() => randomUUID());
  const blocks: QResultBlock[] = [];

  for (const [index, finding] of (input.result.findings ?? []).entries()) {
    const statement = finding.statement.trim();
    if (statement.length === 0) continue;
    blocks.push({
      kind: "FINDING",
      finding: {
        findingId: QFindingIdSchema.parse(idFor(index)),
        // An unrecognised type is an observation, not a guess at a
        // stronger one: reading a model's label as RISK when the contract
        // does not know it would be inventing severity.
        type: (FINDING_TYPES.has(finding.type ?? "")
          ? finding.type
          : "OBSERVATION") as QFindingType,
        statement,
        confidence: (CONFIDENCE_LEVELS.has(finding.confidence ?? "")
          ? finding.confidence
          : "MODERATE") as QConfidenceLevel,
        // The model's own reading of what kind of claim this is, passed
        // through rather than re-decided here. An unrecognised value
        // becomes the weakest honest one: a claim whose standing we
        // cannot read is a user claim with no evidence, never a fact.
        truthClass: (TRUTH_CLASSES.has(finding.truthClass ?? "")
          ? finding.truthClass
          : "USER_CLAIM") as TruthClass,
        evidenceStatus: (EVIDENCE_STATUSES.has(finding.evidenceStatus ?? "")
          ? finding.evidenceStatus
          : "SELF_REPORTED") as EvidenceStatus,
        // Deliberately empty. The finding's supporting evidence is real
        // and its identifiers are not the browser's to hold.
        evidenceRefs: [],
        // What the run was authorised about, never what the model named.
        subjects: [...input.subjects],
      },
    });
  }

  // What the supplied context did not establish, and what conflicts in it.
  // Both are absence reported as absence — never a low score for anybody.
  for (const statement of input.result.missingEvidence ?? []) {
    const text = statement.trim();
    if (text.length === 0) continue;
    blocks.push({
      kind: "UNCERTAINTY",
      statement: text,
      confidence: NOT_ESTABLISHED,
    });
  }
  for (const statement of input.result.contradictions ?? []) {
    const text = statement.trim();
    if (text.length === 0) continue;
    blocks.push({
      kind: "UNCERTAINTY",
      statement: text,
      confidence: DISAGREES,
    });
  }

  for (const clarification of input.result.clarifyingQuestions ?? []) {
    const question = clarification.question.trim();
    if (question.length === 0) continue;
    blocks.push({ kind: "CLARIFICATION_REQUEST", question });
  }

  blocks.push(...subjectBlocks(input.subjects));

  if (blocks.length === 0) {
    return undefined;
  }
  // Parsed rather than asserted: a block that does not satisfy the public
  // contract must not reach a client, and the answer is still good text
  // without it.
  const parsed = QResultBlocksSchema.safeParse(blocks);
  return parsed.success ? [...parsed.data] : undefined;
}
