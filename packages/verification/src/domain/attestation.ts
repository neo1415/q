/**
 * The proof a decision by SYNTHETIC_DEMO_ATTESTATION requires.
 *
 * This context does not attest anything itself. The composition root hands
 * in the deployment's existing synthetic-demo allowance (doc 15 §62;
 * `createSyntheticDemoRoutingAllowance` in @capital-q/model-gateway), which
 * exists only when an operator opted in AND the environment is local/test
 * with a loopback database, or hosted staging naming its synthetic
 * Supabase project. Its absence — the answer on every deployment that
 * serves a real person — means no synthetic decision can be made. There is
 * no flag, header or request field in this package that stands in for it.
 */
export type SyntheticDemoAttestation = {
  readonly permitted: true;
  /** The conditions that were checked; recorded as the decision basis. */
  readonly attestation: readonly string[];
};

/** Environments in which a synthetic decision is refused even with a proof. */
const NEVER_SYNTHETIC = new Set(["production", "preview"]);

export type SyntheticDecisionRefusal =
  | "NO_ATTESTATION"
  | "PRODUCTION_POSTURE"
  | "PRINCIPAL_NOT_SYNTHETIC";

/**
 * Deployment-level gate. Belt and braces: the allowance factory already
 * refuses production, and this refuses it again so a proof built by hand
 * in a production process still decides nothing.
 */
export function deploymentRefusal(
  attestation: SyntheticDemoAttestation | null,
  environment: string | undefined,
): SyntheticDecisionRefusal | null {
  if (environment === undefined || NEVER_SYNTHETIC.has(environment)) {
    return "PRODUCTION_POSTURE";
  }
  if (attestation?.permitted !== true) {
    return "NO_ATTESTATION";
  }
  return null;
}

export function decisionBasisOf(
  attestation: SyntheticDemoAttestation,
): string {
  return [
    ...attestation.attestation,
    "requesting account marked synthetic",
  ].join("; ");
}
