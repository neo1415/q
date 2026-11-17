import { z } from "zod";

import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type { EvidenceService } from "../application/service.js";
import { ClaimIdSchema, type Claim } from "../contracts/index.js";
import { ClaimRevisionConflictError } from "../domain/errors.js";
import {
  claimDate,
  STATED_FIGURE_METRICS,
  type StatedFigureMetric,
} from "./stated-figure.js";

/**
 * A founder withdraws one of their company's claims (hygiene audit
 * 2026-11-16 §4.2: a figure whose only evidence was a document they later
 * archived had no way out).
 *
 * Withdrawing is a revision, never a delete: `reviseClaim` writes the next
 * revision with lifecycle SUPERSEDED and the founder's reason, in one
 * transaction with the projection, an audit row and the claim.changed
 * event. Every earlier revision stays. Every investor-facing read
 * (`listCurrentClaims`: the Q Card, read_company_figures, the company
 * sections) keeps CURRENT claims only, and readiness counts live ones, so
 * a withdrawn claim leaves them at once. ADR-001 has no WITHDRAWN value;
 * SUPERSEDED with a reason is the existing lifecycle for "no longer the
 * company's word".
 *
 * Authority stays with Evidence: `reviseClaim` reads the claim inside the
 * actor's tenant and subject (anyone else's claim is "not found") and
 * requires evidence.record on it. The caller (the app action) has already
 * checked the claim is about the actor's own company.
 */

export const ClaimWithdrawalReasonSchema = z.string().trim().min(1).max(400);

export type ClaimWithdrawalEvidence = Pick<
  EvidenceService,
  "getClaim" | "reviseClaim"
>;

export type ClaimWithdrawalOutcome = {
  readonly outcome: "WITHDRAWN" | "ALREADY_WITHDRAWN";
  readonly claimId: string;
  readonly statement: string;
  readonly lifecycleStatus: Claim["lifecycleStatus"];
  readonly revisionNumber: number;
};

const WITHDRAWN = "SUPERSEDED" as const;

const outcomeOf = (
  outcome: ClaimWithdrawalOutcome["outcome"],
  claim: Claim,
): ClaimWithdrawalOutcome => ({
  outcome,
  claimId: claim.id,
  statement: claim.statement,
  lifecycleStatus: claim.lifecycleStatus,
  revisionNumber: claim.currentRevisionNumber,
});

/** The change reason kept on the revision: who withdrew it, and why. */
export function claimWithdrawalReason(reason: string): string {
  return `Withdrawn by the company: ${ClaimWithdrawalReasonSchema.parse(reason)}`;
}

/**
 * Withdraws one claim. Safe to repeat: a claim already withdrawn answers
 * ALREADY_WITHDRAWN and writes nothing. A revision written between the
 * read and the write is re-read once; anything else is the service's own
 * error.
 */
export async function withdrawClaim(
  evidence: ClaimWithdrawalEvidence,
  command: {
    readonly actor: ActorContext;
    readonly claimId: string;
    readonly reason: string;
    readonly correlationId: CorrelationId;
  },
): Promise<ClaimWithdrawalOutcome> {
  const { actor, correlationId } = command;
  const claimId = ClaimIdSchema.parse(command.claimId);
  const changeReason = claimWithdrawalReason(command.reason);
  for (let attempt = 0; ; attempt += 1) {
    const { claim } = await evidence.getClaim({ actor, claimId });
    if (claim.lifecycleStatus === WITHDRAWN) {
      return outcomeOf("ALREADY_WITHDRAWN", claim);
    }
    try {
      const revised = await evidence.reviseClaim({
        actor,
        correlationId,
        input: {
          claimId,
          expectedRevisionNumber: claim.currentRevisionNumber,
          lifecycleStatus: WITHDRAWN,
          changeReason,
        },
      });
      return outcomeOf("WITHDRAWN", revised);
    } catch (error: unknown) {
      if (!(error instanceof ClaimRevisionConflictError) || attempt >= 1) {
        throw error;
      }
    }
  }
}

/**
 * Q's path: the company's live claims for one metric (and date, and value
 * when given), so "withdraw our October MRR of 42,000" names exactly one.
 */
export async function withdrawableFigureClaims(
  evidence: Pick<EvidenceService, "listClaims">,
  actor: ActorContext,
  companyId: string,
  figure: {
    readonly metric: StatedFigureMetric;
    readonly asOf: string | null;
    readonly amount?: number | undefined;
  },
): Promise<readonly Claim[]> {
  const metric = STATED_FIGURE_METRICS[figure.metric];
  const claims = await evidence.listClaims({
    actor,
    subject: { subjectType: "COMPANY", subjectId: companyId },
    claimKey: metric.claimKey,
  });
  return claims.filter((claim) => {
    if (claim.lifecycleStatus === WITHDRAWN) return false;
    if (figure.asOf !== null && claimDate(claim) !== figure.asOf) return false;
    if (figure.amount === undefined) return true;
    const stored = claim.structuredValue;
    const raw = stored?.["amount"] ?? stored?.["value"];
    return (
      (typeof raw === "string" || typeof raw === "number") &&
      Number(raw) === figure.amount
    );
  });
}
