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
/** Environments that attest through a loopback database on the operator's own machine. */
const LOOPBACK_ENVIRONMENTS = new Set(["local", "test"]);

/**
 * The Supabase project a connection string belongs to.
 *
 * Two forms are in use: a direct database host is `db.<ref>.supabase.co`,
 * and a pooled one carries the ref in the user as `postgres.<ref>`. Both
 * are read, because a deployment that switched to the pooler must not
 * silently stop being identifiable.
 */
export function supabaseProjectRefOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const fromHost = /^db\.([a-z0-9]{16,})\.supabase\.(co|com|net)$/i.exec(
    parsed.hostname,
  );
  if (fromHost?.[1] !== undefined) return fromHost[1].toLowerCase();
  const fromProjectHost = /^([a-z0-9]{16,})\.supabase\.(co|com|net)$/i.exec(
    parsed.hostname,
  );
  if (fromProjectHost?.[1] !== undefined)
    return fromProjectHost[1].toLowerCase();
  const fromUser = /^postgres\.([a-z0-9]{16,})$/i.exec(
    decodeURIComponent(parsed.username),
  );
  if (fromUser?.[1] !== undefined) return fromUser[1].toLowerCase();
  return null;
}

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
  /**
   * CAPITAL_Q_ENV. `local` and `test` attest through a loopback database;
   * `staging` attests by naming the synthetic Supabase project it is
   * pinned to. `preview` and `production` can never attest.
   */
  readonly environment: string | undefined;
  /** The database this process talks to. */
  readonly databaseUrl: string;
  /**
   * `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED` — the deployment's own statement
   * that everything it holds was invented (QX-004 §0.3).
   *
   * Separate from the operator's routing opt-in on purpose. The opt-in
   * says "prefer the free route where it is allowed"; this says "there is
   * no customer here". A hosted deployment has no loopback database to
   * prove the second with, so it has to be said.
   */
  readonly hostedAttested?: boolean | undefined;
  /**
   * `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF` — the Supabase project the
   * attestation is about.
   *
   * Deliberately an identifier rather than a boolean: an operator has to
   * name the exact project they are vouching for, and a service later
   * repointed at another one stops attesting at startup instead of
   * routing a real customer's material to a free provider.
   */
  readonly syntheticProjectRef?: string | undefined;
  /** `SUPABASE_URL`, for the project this process is actually using. */
  readonly supabaseUrl?: string | undefined;
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
  // Production first, and before the opt-in check: a deployment that
  // serves real people and nevertheless carries a synthetic attestation is
  // a configuration mistake that must stop the process, not a flag to
  // quietly ignore. `preview` is refused for the same reason — it mirrors
  // a real pushed checkpoint against real-shaped data.
  if (
    options.hostedAttested === true &&
    (options.environment === "production" || options.environment === "preview")
  ) {
    throw new SyntheticDemoRoutingRefusedError(
      `a synthetic-demo attestation cannot hold in ${options.environment}`,
    );
  }

  if (!options.operatorEnabled) return null;

  let host: string;
  try {
    host = new URL(options.databaseUrl).hostname;
  } catch {
    throw new SyntheticDemoRoutingRefusedError("database URL is not parseable");
  }

  /**
   * Hosted staging (QX-004 §0.3).
   *
   * There is no loopback database to point at, so the proof is that the
   * operator named the synthetic Supabase project and this process is
   * demonstrably using that project and no other. The declared
   * sensitivity of a request is untouched by any of this: a RESTRICTED
   * synthetic payload stays RESTRICTED, and only provider eligibility
   * changes, because the deployment has said there is no customer here.
   */
  if (options.environment === "staging") {
    if (options.hostedAttested !== true) {
      throw new SyntheticDemoRoutingRefusedError(
        "hosted staging must set the synthetic-demo attestation explicitly",
      );
    }
    const declared = options.syntheticProjectRef?.trim().toLowerCase();
    if (declared === undefined || declared.length === 0) {
      throw new SyntheticDemoRoutingRefusedError(
        "hosted staging must name the synthetic Supabase project it attests about",
      );
    }
    // Every identifier this process can see must agree. A staging service
    // repointed at another project fails here rather than routing.
    const inUse = [
      supabaseProjectRefOf(options.databaseUrl),
      options.supabaseUrl === undefined
        ? null
        : supabaseProjectRefOf(options.supabaseUrl),
    ].filter((ref): ref is string => ref !== null);
    if (inUse.length === 0) {
      throw new SyntheticDemoRoutingRefusedError(
        "the Supabase project in use could not be identified",
      );
    }
    const disagreeing = inUse.find((ref) => ref !== declared);
    if (disagreeing !== undefined) {
      throw new SyntheticDemoRoutingRefusedError(
        "the attested synthetic Supabase project is not the one in use",
      );
    }
    return {
      permitted: true,
      attestation: Object.freeze([
        "operator opted in",
        "environment staging",
        "deployment attested synthetic",
        `supabase project ${declared}`,
      ]),
    };
  }

  if (
    options.environment === undefined ||
    !LOOPBACK_ENVIRONMENTS.has(options.environment)
  ) {
    throw new SyntheticDemoRoutingRefusedError(
      `CAPITAL_Q_ENV must be local, test or staging (got ${options.environment ?? "unset"})`,
    );
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
