import type { ActorContext } from "@capital-q/security";

import type { ClaimProposalBatch, ExtractionPassage } from "./contracts.js";

/**
 * Where proposals come from (CQ-KNW-001 §12, §15, §37).
 *
 * The Evidence context defines this and never implements it with a model.
 * A provider SDK, a prompt, a token budget and a routing decision are all
 * on the other side of this port; Evidence receives typed proposals and
 * treats them as untrusted whatever produced them.
 *
 * A proposer is handed the passage the server assembled and the claim keys
 * it may use. It is handed no tenant, no actor authority it can act on, no
 * database and no way to write anything.
 */
export type ClaimProposerPort = {
  readonly propose: (request: {
    readonly passage: ExtractionPassage;
    readonly claimKeys: readonly string[];
    /** For attribution and provider eligibility only; never for writing. */
    readonly actor: ActorContext;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<ClaimProposalBatch>;
};

/**
 * The proposer could not run, and privacy was not traded to make it (§14).
 *
 * `PROVIDER_INELIGIBLE` is a policy answer, not an outage: no configured
 * provider may receive material of this source's sensitivity. The correct
 * response is to record nothing and say so — never to relabel the passage
 * as less sensitive so that a cheaper provider will accept it.
 *
 * The other reasons say what actually happened, because "no eligible
 * provider" for an answer the schema refused sends whoever reads the alert
 * to the wrong place (A8 live 2026-11-14):
 *
 *   PROVIDER_UNAVAILABLE — no provider could be reached (outage, account,
 *                          spend limit, none configured).
 *   SCHEMA_REFUSED       — a provider answered and the answer did not fit
 *                          the task's schema; `refusals` says which fields.
 *   MODEL_FAILED         — a provider was asked and gave nothing usable for
 *                          another reason (timeout, rate limit, context).
 */
export const CLAIM_PROPOSAL_BLOCKED_REASONS = [
  "PROVIDER_INELIGIBLE",
  "PROVIDER_UNAVAILABLE",
  "SCHEMA_REFUSED",
  "MODEL_FAILED",
] as const;
export type ClaimProposalBlockedReason =
  (typeof CLAIM_PROPOSAL_BLOCKED_REASONS)[number];

const BLOCKED_MESSAGES: Readonly<Record<ClaimProposalBlockedReason, string>> =
  {
    PROVIDER_INELIGIBLE:
      "no configured provider may receive material of this sensitivity",
    PROVIDER_UNAVAILABLE: "no proposer was available",
    SCHEMA_REFUSED: "the proposer's answer did not fit the extraction schema",
    MODEL_FAILED: "the proposer gave no usable answer",
  };

export class ClaimProposalBlockedError extends Error {
  readonly reason: ClaimProposalBlockedReason;
  /** The gateway's failure class, when a gateway said why. Never model text. */
  readonly failureClass: string | undefined;
  /** Field paths and schema codes the answer was refused for. Bounded. */
  readonly refusals: readonly string[];

  constructor(
    reason: ClaimProposalBlockedReason,
    detail: {
      readonly failureClass?: string | undefined;
      readonly refusals?: readonly string[] | undefined;
    } = {},
  ) {
    super(BLOCKED_MESSAGES[reason]);
    this.name = "ClaimProposalBlockedError";
    this.reason = reason;
    this.failureClass = detail.failureClass;
    this.refusals = (detail.refusals ?? []).slice(0, 8);
  }
}
