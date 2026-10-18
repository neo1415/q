import type { VerificationClaimsPort } from "../application/ports.js";

/**
 * The production Verification seam as it stands: no Verification bounded
 * context exists yet (doc 13 §24 specifies `evidence.verification_claims`;
 * doc 25 §62/§137 defer the provider while preserving the state contract).
 *
 * This adapter answers the truth — nothing is verified and verification
 * is not available — so the readiness policy reports the two verification
 * requirements as outstanding for every company, and the screen says why.
 * It is deliberately not configurable: there is no flag, header or
 * environment variable that makes it answer VERIFIED. When the
 * Verification context arrives, its own query port replaces this file.
 */
export function createUnavailableVerificationClaimsPort(): VerificationClaimsPort {
  return {
    sourceLabel: "VERIFICATION_UNAVAILABLE",
    currentStandings: () =>
      Promise.resolve({
        available: false,
        founderIdentity: "NOT_VERIFIED",
        organisationIdentity: "NOT_VERIFIED",
      }),
  };
}
