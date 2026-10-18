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

/** One of Capital Q's claims as a public surface may state it. */
export type PublicClaimStanding = {
  readonly verified: boolean;
  /**
   * True when the standing rests on the synthetic-demo attestation: demo
   * data on a demo deployment, never a real-world check. Every surface
   * that says "verified" must say this too (the owner's view does, through
   * `describeStanding`).
   */
  readonly syntheticDemo: boolean;
};

/**
 * The standings a public surface (the Q Card) may state, with how each was
 * decided, so a synthetic attestation can never read as Capital Q's check.
 */
export function createPublicVerificationReader(options: {
  readonly sql: DatabaseExecutor;
  readonly repository?: VerificationClaimRepository | undefined;
  readonly clock?: (() => Date) | undefined;
}): {
  readonly companyStandings: (subject: {
    readonly tenantId: string;
    readonly organisationId: string;
  }) => Promise<{
    readonly organisation: PublicClaimStanding;
    readonly founderIdentity: PublicClaimStanding;
  }>;
} {
  const repository =
    options.repository ?? createPostgresVerificationClaimRepository();
  const clock = options.clock ?? (() => new Date());
  const standing = (
    claim: ReturnType<typeof founderIdentityOf>,
    now: Date,
  ): PublicClaimStanding => {
    const verified = standingOf(claim, now) === "VERIFIED";
    return {
      verified,
      syntheticDemo: verified && claim?.method === "SYNTHETIC_DEMO_ATTESTATION",
    };
  };
  return {
    companyStandings: async (subject) => {
      const now = clock();
      const claims = await repository.currentForOrganisation(
        options.sql,
        subject.tenantId,
        subject.organisationId,
      );
      return {
        organisation: standing(
          organisationIdentityOf(claims, subject.organisationId),
          now,
        ),
        founderIdentity: standing(founderIdentityOf(claims, null, now), now),
      };
    },
  };
}
