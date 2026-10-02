import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * ADMIN-3 (docs/specs/2026-10/admin-escalation-kyb.md): appeals Stage 4
 * human review (PADL #050) and manual KYB. The person's side and the
 * console's side.
 */

export const REVIEWS_PATH = "/v1/reviews" as const;
export const KYB_PATH = "/v1/kyb" as const;
export const ADMIN_REVIEWS_PATH = "/v1/admin/reviews" as const;
export const ADMIN_REVIEW_DECISION_PATH =
  "/v1/admin/reviews/:reviewId/decision" as const;
export const ADMIN_KYB_DOCUMENT_PATH =
  "/v1/admin/kyb/:submissionId/document" as const;

export const HUMAN_REVIEW_SUBJECTS = [
  "READINESS_ASSESSMENT",
  "VERIFICATION_DECISION",
  "ACCOUNT_ACTION",
  "Q_ASSESSMENT",
  "OTHER",
] as const;
export const HumanReviewSubjectSchema = z.enum(HUMAN_REVIEW_SUBJECTS);
export type HumanReviewSubject = z.infer<typeof HumanReviewSubjectSchema>;

export const HUMAN_REVIEW_OUTCOMES = [
  "UPHELD",
  "CHANGED",
  "NEEDS_EVIDENCE",
] as const;
export const HumanReviewOutcomeSchema = z.enum(HUMAN_REVIEW_OUTCOMES);

/** A reference to what is under review: an id, never content. */
export const HumanReviewSubjectRefSchema = z
  .string()
  .regex(/^[A-Za-z0-9_:.-]{1,200}$/);

export const HumanReviewRequestSchema = z
  .object({
    subjectType: HumanReviewSubjectSchema,
    subjectRef: HumanReviewSubjectRefSchema.nullable().optional(),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export type HumanReviewRequest = z.infer<typeof HumanReviewRequestSchema>;

const Iso = z.string().max(40);

export const HumanReviewDtoSchema = z
  .object({
    reviewId: UuidSchema,
    subjectType: HumanReviewSubjectSchema,
    subjectRef: z.string().max(200).nullable(),
    reason: z.string().max(2000),
    source: z.enum(["APP", "Q"]),
    status: z.enum(["OPEN", "DECIDED"]),
    outcome: HumanReviewOutcomeSchema.nullable(),
    decisionReason: z.string().max(2000).nullable(),
    dueAt: Iso,
    decidedAt: Iso.nullable(),
    createdAt: Iso,
  })
  .strict();
export type HumanReviewDto = z.infer<typeof HumanReviewDtoSchema>;

export const HumanReviewListDtoSchema = z
  .object({ rows: z.array(HumanReviewDtoSchema).max(50) })
  .strict();

export const AdminReviewRowDtoSchema = HumanReviewDtoSchema.extend({
  requesterUserId: UuidSchema,
  requesterName: z.string().max(300).nullable(),
  organisationName: z.string().max(300).nullable(),
  overdue: z.boolean(),
  decidedByName: z.string().max(300).nullable(),
}).strict();
export type AdminReviewRowDto = z.infer<typeof AdminReviewRowDtoSchema>;

export const AdminReviewListDtoSchema = z
  .object({ rows: z.array(AdminReviewRowDtoSchema).max(200) })
  .strict();

export const AdminReviewDecisionRequestSchema = z
  .object({
    outcome: HumanReviewOutcomeSchema,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

export const AdminReviewDecisionDtoSchema = z
  .object({ decided: z.literal(true) })
  .strict();

export const AdminKybDocumentDtoSchema = z
  .object({ url: z.string().url().max(4000), expiresAt: Iso })
  .strict();

// --- KYB (the organisation's side) ---------------------------------------------

export const KybRequestSchema = z
  .object({
    legalName: z.string().trim().min(1).max(300),
    registrationNumber: z.string().trim().min(1).max(100),
    jurisdictionCode: z.string().regex(/^[A-Z]{2}$/),
    registeredAddress: z.string().trim().min(1).max(500).nullable().optional(),
    websiteUrl: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/)
      .max(500)
      .nullable()
      .optional(),
    documentId: UuidSchema.nullable().optional(),
  })
  .strict();
export type KybRequest = z.infer<typeof KybRequestSchema>;

export const KybDtoSchema = z
  .object({
    standing: z.enum([
      "NOT_REQUESTED",
      "PENDING",
      "VERIFIED",
      "EXPIRED",
      "REVOKED",
    ]),
    submission: z
      .object({
        submissionId: UuidSchema,
        source: z.enum(["PERSON", "AUTO"]),
        legalName: z.string().max(300).nullable(),
        registrationNumber: z.string().max(100).nullable(),
        jurisdictionCode: z.string().max(2).nullable(),
        registeredAddress: z.string().max(500).nullable(),
        websiteUrl: z.string().max(500).nullable(),
        hasDocument: z.boolean(),
        status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"]),
        decisionReason: z.string().max(1000).nullable(),
        submittedAt: Iso,
        decidedAt: Iso.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type KybDto = z.infer<typeof KybDtoSchema>;
