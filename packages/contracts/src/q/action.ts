import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QRunIdSchema,
} from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";
import { QContractVersionSchema } from "./version.js";

/**
 * A consequential action Q has PREPARED (doc 12 §30-31; doc 22 §79-82).
 *
 *   Proposal  ≠  Approval  ≠  Execution
 *
 * A proposal is Q saying "here is what I would do". It carries no authority.
 * An approval is a separate application record a human creates, bound to the
 * exact proposed payload; an execution is a separate deterministic step that
 * happens only after that. This packet defines the proposal shape and the
 * minimum reference to an approval. It does not define approval mutations,
 * payload hashing, execution records or idempotency keys -- those are
 * CQ-Q-008 and the tool packets that follow.
 *
 * Nothing here is accepted from a client. A browser cannot submit a proposal
 * and cannot mark one approved; the public request schema has no field for
 * either.
 */

/**
 * The kind of action, as a dotted lower_snake_case name: `message.send`,
 * `document.share`, `meeting.propose`. Bounded shape only; the registry of
 * what exists is CQ-Q-007/008's.
 */
export const QActionTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "expected a dotted lower_snake_case action type",
  )
  .max(128);

export type QActionType = z.infer<typeof QActionTypeSchema>;

/** Policy classes an action maps onto (doc 12 §30). */
export const Q_ACTION_CLASSES = [
  "SAFE_READ",
  "LOW_RISK_INTERNAL",
  "PREPARE_ONLY",
  "CONFIRM_REQUIRED",
  "RESTRICTED",
  /** Never proposed. Present so policy can name it; a proposal carrying it is invalid. */
  "PROHIBITED",
] as const;

export type QActionClass = (typeof Q_ACTION_CLASSES)[number];

export const QActionClassSchema = z.enum(Q_ACTION_CLASSES);

/**
 * The durable lifecycle of a persisted Q action (doc 13 §48.1 `status`;
 * CQ-Q-008 §20). Set only by the q-actions lifecycle policy, never by a
 * model, a tool result, a client or a graph checkpoint. The proposal's own
 * public status (PROPOSED/WITHDRAWN/EXPIRED) and the approval's status are
 * separate records; this is where execution truth lives.
 *
 *   PROPOSED                 created; no approval needed or not yet requested
 *   AWAITING_APPROVAL        a PENDING approval exists
 *   APPROVED                 a valid approval was recorded; nothing executed
 *   EXECUTING                execution claimed atomically by exactly one worker
 *   EXECUTED                 the deterministic executor reported success
 *   FAILED                   the executor reported a definite failure
 *   RECONCILIATION_REQUIRED  the executor could not say whether the side
 *                            effect happened (timeout); never retried blindly
 *   REJECTED · EXPIRED · WITHDRAWN  ended without execution
 */
export const Q_ACTION_STATUSES = [
  "PROPOSED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
] as const;

export type QActionStatus = (typeof Q_ACTION_STATUSES)[number];

export const QActionStatusSchema = z.enum(Q_ACTION_STATUSES);

/**
 * Once here, an action never changes status again; a new action is a new
 * record. FAILED is deliberately not here: a definite, retryable executor
 * failure may be retried under the same approval while it is valid and
 * the payload unchanged (CQ-Q-008 §71-§72). A non-retryable failure is
 * ended by policy, not by this set.
 */
export const Q_ACTION_TERMINAL_STATUSES = [
  "EXECUTED",
  "RECONCILIATION_REQUIRED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN",
] as const satisfies readonly QActionStatus[];

const TERMINAL_ACTION: ReadonlySet<QActionStatus> = new Set(
  Q_ACTION_TERMINAL_STATUSES,
);

export function isTerminalQActionStatus(status: QActionStatus): boolean {
  return TERMINAL_ACTION.has(status);
}

/** A registered action definition's integer version; part of the binding. */
export const QActionVersionSchema = z.number().int().min(1);

/** `sha256:<64 hex>` — the stable representation of a payload binding hash. */
export const QActionPayloadHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<hex digest>");
export type QActionPayloadHash = z.infer<typeof QActionPayloadHashSchema>;

export const Q_ACTION_BINDING_VERSION = 1 as const;

/**
 * INTERNAL. The approval-bound envelope (CQ-Q-008 §24): every field whose
 * change alters the consequence, and nothing volatile. Hashed through the
 * canonical JSON serialiser; the hash is what an approval binds to and
 * what execution re-verifies. Timestamps, request ids, trace ids and
 * summaries are deliberately absent: a summary may omit material detail
 * and a timestamp would make the same consequence hash differently.
 */
export const QActionBindingEnvelopeSchema = z
  .object({
    bindingVersion: z.literal(Q_ACTION_BINDING_VERSION),
    tenantId: UuidSchema,
    /** The organisation context the action is taken for, when there is one. */
    organisationId: UuidSchema.nullable(),
    runId: QRunIdSchema,
    actionId: QActionProposalIdSchema,
    actionType: QActionTypeSchema,
    actionVersion: QActionVersionSchema,
    actionClass: QActionClassSchema,
    targets: QSubjectRefsSchema.min(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type QActionBindingEnvelope = z.infer<
  typeof QActionBindingEnvelopeSchema
>;

/** Classes for which a proposal must declare that approval is required. */
export const Q_APPROVAL_REQUIRED_ACTION_CLASSES = [
  "CONFIRM_REQUIRED",
  "RESTRICTED",
] as const satisfies readonly QActionClass[];

/**
 * The proposal's own lifecycle. Approval outcomes are not proposal statuses:
 * an approved proposal is still a proposal, now with an APPROVED approval
 * attached, and whether it then executed is a third record's business.
 */
export const Q_ACTION_PROPOSAL_STATUSES = [
  "PROPOSED",
  "WITHDRAWN",
  "EXPIRED",
] as const;

export type QActionProposalStatus = (typeof Q_ACTION_PROPOSAL_STATUSES)[number];

export const QActionProposalStatusSchema = z.enum(Q_ACTION_PROPOSAL_STATUSES);

/** Approval record states (doc 12 §31.1). Owned and mutated by CQ-Q-008 only. */
export const Q_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
] as const;

export type QApprovalStatus = (typeof Q_APPROVAL_STATUSES)[number];

export const QApprovalStatusSchema = z.enum(Q_APPROVAL_STATUSES);

/**
 * The minimum a result or event needs to point at an approval. A reference,
 * not the record: it grants nothing and cannot be used to approve anything.
 */
export const QApprovalRefSchema = z
  .object({
    approvalId: QApprovalIdSchema,
    status: QApprovalStatusSchema,
  })
  .strict();

export type QApprovalRef = z.infer<typeof QApprovalRefSchema>;

/**
 * Whether a proposal needs a human before anything happens, and where that
 * stands. `required: true` with no approval yet is the normal state of a
 * freshly prepared consequential action. There is no `approved: true`
 * shortcut anywhere on this shape.
 */
export const QApprovalRequirementSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false) }).strict(),
  z
    .object({
      required: z.literal(true),
      approval: QApprovalRefSchema.optional(),
    })
    .strict(),
]);

export type QApprovalRequirement = z.infer<typeof QApprovalRequirementSchema>;

export const Q_ACTION_SUMMARY_MAX_LENGTH = 1000;
export const Q_ACTION_PREVIEW_MAX_LENGTH = 4000;

export const QActionProposalSchema = z
  .object({
    contractVersion: QContractVersionSchema,
    proposalId: QActionProposalIdSchema,
    runId: QRunIdSchema,
    actionType: QActionTypeSchema,
    actionClass: QActionClassSchema,
    /** What the action would touch. At least one; never a free-text target. */
    targets: QSubjectRefsSchema.min(1),
    /** What Q would do, in plain language a person approves or declines. */
    summary: z.string().trim().min(1).max(Q_ACTION_SUMMARY_MAX_LENGTH),
    /**
     * A bounded plain-text preview of the prepared content -- a draft
     * message, a proposed time. Presentation for the approver. The exact
     * payload an approval binds to, and its hash, are CQ-Q-008's.
     */
    preview: z.string().max(Q_ACTION_PREVIEW_MAX_LENGTH).optional(),
    approval: QApprovalRequirementSchema,
    status: QActionProposalStatusSchema,
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.optional(),
  })
  .strict()
  .refine((proposal) => proposal.actionClass !== "PROHIBITED", {
    message: "a prohibited action is never proposed",
    path: ["actionClass"],
  })
  .refine(
    (proposal) =>
      !(Q_APPROVAL_REQUIRED_ACTION_CLASSES as readonly string[]).includes(
        proposal.actionClass,
      ) || proposal.approval.required,
    {
      message: "this action class always requires approval",
      path: ["approval"],
    },
  );

export type QActionProposal = z.infer<typeof QActionProposalSchema>;
