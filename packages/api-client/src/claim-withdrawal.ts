import {
  CLAIM_WITHDRAW_SEGMENT,
  CLAIMS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  WithdrawClaimResponseSchema,
  type WithdrawClaimRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * `POST /v1/claims/:id/withdraw` — a founder withdraws one of their own
 * company's claims, with a reason. A new revision, never a delete. One key
 * per intent: the same on a retry, so it runs once.
 */
export function withdrawClaim(
  session: ApiSession,
  claimId: string,
  request: WithdrawClaimRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${CLAIMS_PATH}/${encodeURIComponent(claimId)}${CLAIM_WITHDRAW_SEGMENT}`,
    WithdrawClaimResponseSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}
