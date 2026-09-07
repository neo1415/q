import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";
import { MarketplaceVisibilitySchema } from "../http/companies.js";
import { MessageSensitivitySchema } from "../messaging/sensitivity.js";
import { QConfidenceLevelSchema } from "./confidence.js";
import { QEvidenceRefsSchema } from "./evidence-ref.js";
import { QFindingIdSchema, QRunIdSchema } from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";

/**
 * A structured thing Q found during a run (doc 12 §12.3).
 *
 * A finding is run output. It is not a Q Knowledge Object, not a Claim and
 * not canonical company state: nothing here is persisted as institutional
 * knowledge by virtue of existing, and the deterministic Write Gate that may
 * later promote a finding belongs to the CQ-KNW packets.
 *
 * Truth class, evidence status, lifecycle status and confidence are four
 * axes and stay four fields (ADR-001). A Q_INFERENCE with HIGH confidence is
 * still an inference, and a VERIFIED fact with a STALE lifecycle is still
 * verified and still stale.
 */
export const Q_FINDING_TYPES = [
  "FACT",
  "OBSERVATION",
  "INFERENCE",
  "RISK",
  "STRENGTH",
  "GAP",
  "RECOMMENDATION",
  "UNCERTAINTY",
] as const;

export type QFindingType = (typeof Q_FINDING_TYPES)[number];

export const QFindingTypeSchema = z.enum(Q_FINDING_TYPES);

export const Q_FINDING_STATEMENT_MAX_LENGTH = 2000;
export const Q_FINDING_ASSUMPTION_MAX_LENGTH = 500;
export const Q_FINDING_ASSUMPTIONS_MAX = 10;

const findingShape = {
  findingId: QFindingIdSchema,
  type: QFindingTypeSchema,
  /** The finding in plain language. Not the reasoning that reached it. */
  statement: z.string().trim().min(1).max(Q_FINDING_STATEMENT_MAX_LENGTH),
  truthClass: TruthClassSchema,
  evidenceStatus: EvidenceStatusSchema,
  lifecycleStatus: LifecycleStatusSchema.optional(),
  confidence: QConfidenceLevelSchema,
  evidenceRefs: QEvidenceRefsSchema,
  subjects: QSubjectRefsSchema,
  /** Stated assumptions the finding rests on. Surfaced, never hidden. */
  assumptions: z
    .array(z.string().trim().min(1).max(Q_FINDING_ASSUMPTION_MAX_LENGTH))
    .max(Q_FINDING_ASSUMPTIONS_MAX)
    .optional(),
  /** When the finding was true, if it is time-bound. */
  validAt: UtcTimestampSchema.optional(),
};

/**
 * PUBLIC. The finding as a client may receive it.
 *
 * This schema is the allowlist. A public finding carries only the evidence
 * references the disclosure layer has permitted for this reader; the
 * projection that removes the rest is CQ-Q-004's job, and it is a policy
 * decision, not a field-stripping helper -- which is why no such helper is
 * provided here.
 */
export const QPublicFindingSchema = z.object(findingShape).strict();

export type QPublicFinding = z.infer<typeof QPublicFindingSchema>;

/**
 * INTERNAL. What the runtime holds: the public shape plus the classification
 * the firewall needs to decide what may leave.
 *
 * `sensitivity` answers how damaging exposure would be; `visibilityScope`
 * answers who may see it. Two questions, two fields, never merged. Neither
 * appears on the public projection.
 */
export const QInternalFindingSchema = z
  .object({
    ...findingShape,
    runId: QRunIdSchema,
    sensitivity: MessageSensitivitySchema,
    visibilityScope: MarketplaceVisibilitySchema,
    /** Findings this one disagrees with. Contradictions coexist until reconciled. */
    contradicts: z.array(QFindingIdSchema).max(10).optional(),
  })
  .strict();

export type QInternalFinding = z.infer<typeof QInternalFindingSchema>;
