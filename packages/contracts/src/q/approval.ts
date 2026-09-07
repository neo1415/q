import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import {
  Q_ACTION_PREVIEW_MAX_LENGTH,
  Q_ACTION_SUMMARY_MAX_LENGTH,
  QActionClassSchema,
  QActionStatusSchema,
  QActionTypeSchema,
  QActionVersionSchema,
  QApprovalStatusSchema,
} from "./action.js";
import {
  QActionProposalIdSchema,
  QApprovalIdSchema,
  QRunIdSchema,
} from "./ids.js";
import { QSubjectRefsSchema } from "./subject.js";
import { QContractVersionSchema } from "./version.js";

/**
 * The approval surface (doc 12 §31; doc 22 §80-82; CQ-Q-008 §41-§43, §84-§86).
 *
 *   Q proposal ≠ approval ≠ permission ≠ execution ≠ outcome
 *
 * PUBLIC shapes only. What a person needs in order to decide: what Q wants
 * to do, to whom or what, the exact material content, whether approval is
 * still open, and when it expires. What is deliberately absent: the payload
 * hash (an internal integrity fingerprint the client has no use for and
 * must never be able to supply), any actor identifier but the requested
 * approver's own view, and any raw row.
 *
 * The approve and reject requests carry no authority: the server loads the
 * canonical proposal, resolves the actor from the verified session, and
 * verifies the hash it computed itself. There is no field for a payload,
 * a hash, a tenant, an approver or a flag that skips a check, so nothing
 * a browser sends can widen what is approved.
 */

/** The part of a prepared action a person is shown before deciding. */
export const QApprovalActionViewSchema = z
  .object({
    actionId: QActionProposalIdSchema,
    actionType: QActionTypeSchema,
    actionVersion: QActionVersionSchema,
    actionClass: QActionClassSchema,
    /** The durable execution status; success is only ever stated here. */
    actionStatus: QActionStatusSchema,
    targets: QSubjectRefsSchema.min(1),
    /** Plain language: what Q would do. */
    summary: z.string().trim().min(1).max(Q_ACTION_SUMMARY_MAX_LENGTH),
    /** The exact material content the approval binds to, for review. */
    preview: z.string().max(Q_ACTION_PREVIEW_MAX_LENGTH).optional(),
    executedAt: UtcTimestampSchema.optional(),
  })
  .strict();

export type QApprovalActionView = z.infer<typeof QApprovalActionViewSchema>;

/** PUBLIC. `GET /v1/q/approvals/:approvalId` and the body of a decision response. */
export const QApprovalViewSchema = z
  .object({
    contractVersion: QContractVersionSchema,
    approvalId: QApprovalIdSchema,
    runId: QRunIdSchema,
    status: QApprovalStatusSchema,
    requestedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    /** When the approval was approved, rejected or revoked; absent while pending. */
    decidedAt: UtcTimestampSchema.optional(),
    /** True only while PENDING and not yet past expiresAt. */
    canDecide: z.boolean(),
    action: QApprovalActionViewSchema,
  })
  .strict();

export type QApprovalView = z.infer<typeof QApprovalViewSchema>;

/** PUBLIC. `POST /v1/q/approvals/:approvalId/approve` accepts an empty object only. */
export const ApproveQApprovalRequestSchema = z.object({}).strict();
export type ApproveQApprovalRequest = z.infer<
  typeof ApproveQApprovalRequestSchema
>;

export const Q_APPROVAL_REJECTION_REASON_MAX_LENGTH = 500;

/** PUBLIC. `POST /v1/q/approvals/:approvalId/reject`; the reason is optional and bounded. */
export const RejectQApprovalRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(Q_APPROVAL_REJECTION_REASON_MAX_LENGTH)
      .optional(),
  })
  .strict();
export type RejectQApprovalRequest = z.infer<
  typeof RejectQApprovalRequestSchema
>;
