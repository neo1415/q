import type { SyntheticDemoAttestation } from "./attestation.js";

/**
 * R43 — the hosted staging workers verify synthetic-marked accounts on
 * their own. Temporary until BIZ-006 /ops ships and the founder decides
 * verification by hand. TODO(BIZ-006): delete this policy, its sweep and
 * the workers' fallback to it.
 *
 * Why a second proof exists at all: the synthetic-demo routing allowance
 * (ADR 0014) needs CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED and
 * CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF, and the hosted workers must not
 * hold them, so their decider refused every request and each stayed
 * PENDING. This policy is narrower than that allowance, not a substitute
 * for it: it moves no model route, and it only ever lets the ordinary
 * decider run, which still verifies nothing unless
 *
 *   - CAPITAL_Q_ENV is exactly `staging` (production and preview are
 *     refused here AND again by `deploymentRefusal`);
 *   - the requester and, for FOUNDER_IDENTITY, the founder both carry
 *     `app_metadata.synthetic = true`, writable only with the service role;
 *   - the request is still the current PENDING revision.
 *
 * The decision is the same append-only row, SYSTEM audit and
 * `verification.claim.decided` event as every other; its basis names this
 * policy so an auditor can find and undo exactly these decisions.
 */
export const SYNTHETIC_AUTO_VERIFY_POLICY = {
  id: "SYNTHETIC_AUTO_VERIFY_POLICY",
  version: 1,
  /** The only environments the policy answers in. Never production. */
  environments: ["staging"],
  expires: "temporary until BIZ-006 /ops",
} as const;

const PERMITTED: ReadonlySet<string> = new Set(
  SYNTHETIC_AUTO_VERIFY_POLICY.environments,
);

/**
 * The policy's proof for this process, or null. Null everywhere but
 * `staging`; the decider turns null into NO_ATTESTATION and writes nothing.
 */
export function syntheticAutoVerifyAttestation(
  environment: string | undefined,
): SyntheticDemoAttestation | null {
  if (environment === undefined || !PERMITTED.has(environment)) return null;
  return {
    permitted: true,
    attestation: [
      `${SYNTHETIC_AUTO_VERIFY_POLICY.id} v${String(SYNTHETIC_AUTO_VERIFY_POLICY.version)} (${SYNTHETIC_AUTO_VERIFY_POLICY.expires})`,
      `environment ${environment}`,
    ],
  };
}
