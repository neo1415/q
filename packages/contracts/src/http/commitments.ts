import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Commitments (Product Specification 6.6.14-6.6.15). Money one side of a
 * relationship states, confirmed only by the other side; the fundraising
 * view counts each relationship once, in exactly one bucket.
 *
 * Amounts travel as exact decimal strings with an ISO currency, never as
 * floats.
 */

export const NETWORK_RELATIONSHIP_COMMITMENTS_PATH =
  "/v1/network/relationships/:relationshipId/commitments" as const;
export const NETWORK_COMMITMENT_CONFIRM_PATH =
  "/v1/network/commitments/:commitmentId/confirm" as const;
export const NETWORK_COMMITMENT_ADOPT_PATH =
  "/v1/network/commitments/:commitmentId/adopt" as const;
export const NETWORK_COMMITMENT_DISPUTE_PATH =
  "/v1/network/commitments/:commitmentId/dispute" as const;
export const networkCommitmentAdoptPath = (commitmentId: string) =>
  NETWORK_COMMITMENT_ADOPT_PATH.replace(
    ":commitmentId",
    encodeURIComponent(commitmentId),
  );
export const networkCommitmentDisputePath = (commitmentId: string) =>
  NETWORK_COMMITMENT_DISPUTE_PATH.replace(
    ":commitmentId",
    encodeURIComponent(commitmentId),
  );
export const NETWORK_COMMITMENT_WITHDRAW_PATH =
  "/v1/network/commitments/:commitmentId/withdraw" as const;
export const NETWORK_COMPANY_FUNDRAISING_PATH =
  "/v1/network/companies/:companyId/fundraising" as const;

export const networkRelationshipCommitmentsPath = (relationshipId: string) =>
  NETWORK_RELATIONSHIP_COMMITMENTS_PATH.replace(
    ":relationshipId",
    encodeURIComponent(relationshipId),
  );
export const networkCommitmentConfirmPath = (commitmentId: string) =>
  NETWORK_COMMITMENT_CONFIRM_PATH.replace(
    ":commitmentId",
    encodeURIComponent(commitmentId),
  );
export const networkCommitmentWithdrawPath = (commitmentId: string) =>
  NETWORK_COMMITMENT_WITHDRAW_PATH.replace(
    ":commitmentId",
    encodeURIComponent(commitmentId),
  );
export const networkCompanyFundraisingPath = (companyId: string) =>
  NETWORK_COMPANY_FUNDRAISING_PATH.replace(
    ":companyId",
    encodeURIComponent(companyId),
  );

/** A positive amount with at most two decimals, as a string. */
export const CommitmentAmountSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/)
  .refine((value) => !/^0(?:\.0{1,2})?$/.test(value), {
    message: "must be more than zero",
  });

export const COMMITMENT_LEVELS = ["SOFT", "FIRM", "INVESTED"] as const;
export const CommitmentLevelSchema = z.enum(COMMITMENT_LEVELS);
export type CommitmentLevel = z.infer<typeof CommitmentLevelSchema>;

export const StateCommitmentRequestSchema = z
  .object({
    amount: CommitmentAmountSchema,
    currencyCode: CurrencyCodeSchema,
    level: CommitmentLevelSchema,
    note: z.string().trim().min(1).max(500).optional(),
    /** The call it was said in, from Q's meeting record. */
    meetingId: UuidSchema.optional(),
  })
  .strict();
export type StateCommitmentRequest = z.infer<
  typeof StateCommitmentRequestSchema
>;

export const CommitmentDtoSchema = z
  .object({
    id: UuidSchema,
    amount: z.string(),
    currencyCode: CurrencyCodeSchema,
    level: CommitmentLevelSchema,
    status: z.enum([
      "STATED",
      "CONFIRMED",
      "SUPERSEDED",
      "WITHDRAWN",
      "DETECTED",
      "ADOPTED",
      "DISPUTED",
      // 2026-10-04: the investor's side marked it sent; the company's side
      // confirmed it arrived.
      "TRANSFER_SENT",
      "RECEIVED",
    ]),
    /** PERSON: a party stated it. Q_MEETING: Q heard it in a recorded call. */
    source: z.enum(["PERSON", "Q_MEETING"]),
    /** The words Q heard, for a detected commitment. */
    quote: z.string().nullable(),
    /** Whether the caller's own side stated it. */
    statedByYourSide: z.boolean(),
    statedAt: UtcTimestampSchema,
    confirmedAt: UtcTimestampSchema.nullable(),
    note: z.string().nullable(),
    meetingId: UuidSchema.nullable(),
    /** Only the other side confirms; a current, stated commitment. */
    canConfirm: z.boolean(),
    canWithdraw: z.boolean(),
    /** Detected money either side may adopt (then the other confirms) or dispute. */
    canAdopt: z.boolean(),
    canDispute: z.boolean(),
    /** The company round it counts toward (2026-10-04). */
    roundId: UuidSchema.nullable().optional(),
    transferReference: z.string().nullable().optional(),
    transferSentAt: UtcTimestampSchema.nullable().optional(),
    receivedAt: UtcTimestampSchema.nullable().optional(),
    /** The investor's side, on confirmed money. */
    canMarkSent: z.boolean().optional(),
    /** The company's side, on confirmed or sent money. */
    canConfirmReceived: z.boolean().optional(),
  })
  .strict();
export type CommitmentDto = z.infer<typeof CommitmentDtoSchema>;

export const RelationshipCommitmentsDtoSchema = z
  .object({
    /** The one that counts; null when none. */
    current: CommitmentDtoSchema.nullable(),
    history: z.array(CommitmentDtoSchema).max(20),
    /** Money Q heard in calls, waiting for a party to adopt or dispute it. */
    detected: z.array(CommitmentDtoSchema).max(10),
    /** Commitments open once both sides are connected. */
    connected: z.boolean(),
  })
  .strict();
export type RelationshipCommitmentsDto = z.infer<
  typeof RelationshipCommitmentsDtoSchema
>;

export const FundraisingInvestorDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    investorOrganisationId: UuidSchema,
    investorName: z.string(),
    amount: z.string(),
    currencyCode: CurrencyCodeSchema,
    level: CommitmentLevelSchema,
    bucket: z.enum(["CONFIRMED", "SOFT"]),
  })
  .strict();

export const FundraisingDtoSchema = z
  .object({
    /** The active raise, when there is one. */
    target: z
      .object({ amount: z.string(), currencyCode: CurrencyCodeSchema })
      .nullable(),
    /** Sums per currency; only the target's currency counts toward it. */
    totals: z.array(
      z
        .object({
          currencyCode: CurrencyCodeSchema,
          confirmed: z.string(),
          soft: z.string(),
        })
        .strict(),
    ),
    /** Target minus confirmed in the target's currency; null without a target. */
    remaining: z.string().nullable(),
    /** Connected relationships with no commitment yet: potential, unpriced. */
    pipeline: z.number().int().min(0),
    investors: z.array(FundraisingInvestorDtoSchema).max(200),
  })
  .strict();
export type FundraisingDto = z.infer<typeof FundraisingDtoSchema>;
