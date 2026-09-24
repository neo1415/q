import type {
  VerificationClaimStanding,
  VerificationClaimsPort,
} from "@capital-q/companies";
import type { VerificationStandingStatus } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type { VerificationClaimRepository } from "../application/ports.js";
import {
  founderIdentityOf,
  organisationIdentityOf,
  standingOf,
} from "../domain/claims.js";
import { createPostgresVerificationClaimRepository } from "./postgres-verification-repository.js";

/** Recorded on every readiness transition this port feeds. */
export const VERIFICATION_CLAIMS_SOURCE = "VERIFICATION_CLAIMS" as const;

/** A request waiting on Capital Q is not a standing readiness can use. */
function toReadinessStanding(
  status: VerificationStandingStatus,
): VerificationClaimStanding {
  switch (status) {
    case "VERIFIED":
    case "EXPIRED":
    case "REVOKED":
      return status;
    case "PENDING":
    case "NOT_REQUESTED":
      return "NOT_VERIFIED";
  }
}

/**
 * The Verification context's answer to the Companies readiness seam
 * (replaces `createUnavailableVerificationClaimsPort` in composition).
 *
 * Reads Capital Q's own claim rows and nothing else: no document, no
 * founder statement and no Q reading can make a standing VERIFIED here.
 * `available` is true because the claim record exists; whether anything
 * on this deployment can decide a request is the decider's business, and
 * an undecided request reads as "not verified yet", which is the truth.
 */
export function createVerificationClaimsReadinessPort(options: {
  readonly sql: DatabaseExecutor;
  readonly repository?: VerificationClaimRepository | undefined;
  readonly clock?: (() => Date) | undefined;
}): VerificationClaimsPort {
  const repository =
    options.repository ?? createPostgresVerificationClaimRepository();
  const clock = options.clock ?? (() => new Date());
  return {
    sourceLabel: VERIFICATION_CLAIMS_SOURCE,
    currentStandings: async (subject) => {
      const now = clock();
      const claims = await repository.currentForOrganisation(
        options.sql,
        subject.tenantId,
        subject.organisationId,
      );
      return {
        available: true,
        founderIdentity: toReadinessStanding(
          standingOf(founderIdentityOf(claims, null, now), now),
        ),
        organisationIdentity: toReadinessStanding(
          standingOf(
            organisationIdentityOf(claims, subject.organisationId),
            now,
          ),
        ),
      };
    },
  };
}
