/**
 * Server attestation that a deployment's material is synthetic demo data
 * (doc 15 §62).
 *
 * §62 is the rule this implements, in full: *"Free" is a cost property. It
 * is not a privacy classification. Free/shared inference may be used
 * aggressively for public data, synthetic data, development, low-sensitivity
 * tasks where terms permit. Confidential customer information requires an
 * approved provider/endpoint.*
 *
 * The gateway could not express the first half. It knows a request's
 * sensitivity and a provider's reviewed ceiling, and it treats every
 * request as somebody's data — which is correct, and which is why a demo
 * deployment full of invented companies could only reach a reviewed
 * provider. Migration 20260926 said the same thing from the other side when
 * it reverted the demo posture: the routing preference "takes effect
 * exactly where Gemini is eligible — PUBLIC work, synthetic development
 * data, and any request a reviewed paid tier later justifies." This is that
 * synthetic-development-data case, made executable.
 *
 * What it is NOT:
 *
 *   - not a sensitivity class. Nothing here rewrites a declared
 *     sensitivity, and no provider's reviewed ceiling moves. A confidential
 *     customer request is refused by exactly the same two checks as before.
 *   - not an environment switch. Migration 20260926 is explicit that
 *     "config's deployment environment is operational metadata and no
 *     permission decision may depend on it". The environment is one of
 *     three conditions here and cannot carry the decision alone: an
 *     operator must also opt in, the deployment's database must be
 *     loopback, and the individual request must still declare the posture.
 *   - not reachable from a browser. The posture is a field on the internal
 *     gateway request; no HTTP DTO carries it, and a request that does not
 *     declare it is a customer's.
 *
 * Absent an allowance the posture does nothing at all: `planRoute` falls
 * back to the strict path, which is the behaviour every existing
 * deployment already has.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PERMITTED_ENVIRONMENTS = new Set(["local", "test"]);

/**
 * Proof, held by the composition root, that this process may honour a
 * SYNTHETIC_DEMO posture. Constructed only by the factory below, which is
 * why the gateway can treat its presence as the attestation itself.
 */
export type SyntheticDemoRoutingAllowance = {
  readonly permitted: true;
  /** The conditions that were checked, for the startup log and the postflight. */
  readonly attestation: readonly string[];
};

/** The operator asked for synthetic-demo routing where it cannot hold. */
export class SyntheticDemoRoutingRefusedError extends Error {
  constructor(reason: string) {
    super(`synthetic demo routing refused: ${reason}`);
    this.name = "SyntheticDemoRoutingRefusedError";
  }
}

export type SyntheticDemoRoutingOptions = {
  /**
   * The operator's explicit opt-in for this deployment. False, or absent,
   * is the answer everywhere that serves a real customer.
   */
  readonly operatorEnabled: boolean;
  /** CAPITAL_Q_ENV. Only `local` and `test` can hold demo-only data. */
  readonly environment: string | undefined;
  /** The database this process talks to; must be loopback, as the demo stack's is. */
  readonly databaseUrl: string;
};

/**
 * Null when the operator has not opted in — the ordinary answer, and not an
 * error. Throws when the operator HAS opted in somewhere the claim cannot
 * be true, because a deployment that believes it is a demo and is not
 * should fail at startup rather than route quietly.
 */
export function createSyntheticDemoRoutingAllowance(
  options: SyntheticDemoRoutingOptions,
): SyntheticDemoRoutingAllowance | null {
  if (!options.operatorEnabled) return null;

  if (
    options.environment === undefined ||
    !PERMITTED_ENVIRONMENTS.has(options.environment)
  ) {
    throw new SyntheticDemoRoutingRefusedError(
      `CAPITAL_Q_ENV must be local or test (got ${options.environment ?? "unset"})`,
    );
  }
  let host: string;
  try {
    host = new URL(options.databaseUrl).hostname;
  } catch {
    throw new SyntheticDemoRoutingRefusedError("database URL is not parseable");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    // A hosted database is where real people's companies are. Whatever the
    // operator intended, this deployment is not a demo.
    throw new SyntheticDemoRoutingRefusedError(
      `database host must be loopback (got ${host})`,
    );
  }
  return {
    permitted: true,
    attestation: Object.freeze([
      "operator opted in",
      `environment ${options.environment}`,
      `database host ${host}`,
    ]),
  };
}
