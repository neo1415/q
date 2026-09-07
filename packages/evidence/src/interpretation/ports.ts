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
 */
export class ClaimProposalBlockedError extends Error {
  readonly reason: "PROVIDER_INELIGIBLE" | "PROVIDER_UNAVAILABLE";

  constructor(reason: "PROVIDER_INELIGIBLE" | "PROVIDER_UNAVAILABLE") {
    super(
      reason === "PROVIDER_INELIGIBLE"
        ? "no configured provider may receive material of this sensitivity"
        : "no proposer was available",
    );
    this.name = "ClaimProposalBlockedError";
    this.reason = reason;
  }
}
