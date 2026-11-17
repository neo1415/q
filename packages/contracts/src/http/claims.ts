import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { LifecycleStatusSchema } from "../evidence/vocabulary.js";

/**
 * `POST /v1/claims/:claimId/withdraw` — a founder withdraws one of their
 * own company's claims, with a reason (hygiene audit 2026-11-16 §4.2).
 *
 * A withdrawal is a new revision (lifecycle SUPERSEDED, the reason kept on
 * it), never a delete: the claim and its history stay. Investor-facing
 * reads keep current claims only, so it leaves them. Send an
 * Idempotency-Key: a retry answers the first outcome; withdrawing a claim
 * already withdrawn answers ALREADY_WITHDRAWN and writes nothing.
 */
export const CLAIMS_PATH = "/v1/claims" as const;
export const CLAIM_WITHDRAW_SEGMENT = "/withdraw" as const;

export const WithdrawClaimRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(400),
  })
  .strict();
export type WithdrawClaimRequest = z.infer<typeof WithdrawClaimRequestSchema>;

export const WithdrawClaimResponseSchema = z
  .object({
    claimId: UuidSchema,
    outcome: z.enum(["WITHDRAWN", "ALREADY_WITHDRAWN"]),
    lifecycleStatus: LifecycleStatusSchema,
    revisionNumber: z.number().int().min(1),
  })
  .strict();
export type WithdrawClaimResponse = z.infer<typeof WithdrawClaimResponseSchema>;
