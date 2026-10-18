import type { DatabaseExecutor } from "@capital-q/database";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";
import type { OrganisationId, TenantId } from "@capital-q/security";

import type { VerificationClaimRepository } from "../application/ports.js";
import { createPostgresVerificationClaimRepository } from "./postgres-verification-repository.js";

export type DecidedClaimOwner = {
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
};

/**
 * Who a decision belongs to, read from the claim row rather than from a
 * message (CQ-VERIFY-002). A consumer of `verification.claim.decided`
 * learns the organisation whose readiness to reconcile from here, so a
 * forged or stale event can name a claim but never choose an
 * organisation. A request (PENDING) or an unknown id answers null.
 */
export function createDecidedClaimOwnerLookup(options: {
  readonly sql: DatabaseExecutor;
  readonly repository?: VerificationClaimRepository | undefined;
}) {
  const repository =
    options.repository ?? createPostgresVerificationClaimRepository();
  return async (
    tenantId: string,
    claimId: string,
  ): Promise<DecidedClaimOwner | null> => {
    const claim = await repository.findById(options.sql, tenantId, claimId);
    if (claim === null || claim.status === "PENDING") return null;
    return {
      tenantId: TenantIdSchema.parse(claim.tenantId),
      organisationId: OrganisationIdSchema.parse(claim.organisationId),
    };
  };
}
