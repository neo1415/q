import type { VerificationClaimsPort } from "../application/ports.js";
import type { VerificationClaimStanding } from "../domain/marketplace-readiness.js";

/**
 * A SYNTHETIC verification seam for local development and tests only.
 *
 * It exists so the Recommendation wave can be exercised against at least
 * one legitimately marketplace-ready company on a developer's machine. It
 * is not a verification capability and must never be mistaken for one:
 *
 *   - it refuses to be created unless CAPITAL_Q_ENV is `local` or `test`
 *     AND the database host it is told about is loopback;
 *   - every assessment it feeds records `verificationSource =
 *     SYNTHETIC_LOCAL_FIXTURE` in the audit trail;
 *   - it is reachable only through this package's `dev` entrypoint, which
 *     no application composes and no HTTP route exposes;
 *   - it answers per explicitly listed company id, never "everyone".
 *
 * Test/dev fixture capability ≠ production verification capability.
 */

export const SYNTHETIC_VERIFICATION_SOURCE = "SYNTHETIC_LOCAL_FIXTURE" as const;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PERMITTED_ENVIRONMENTS = new Set(["local", "test"]);

export class SyntheticVerificationRefusedError extends Error {
  constructor(reason: string) {
    super(`synthetic verification refused: ${reason}`);
    this.name = "SyntheticVerificationRefusedError";
  }
}

export type SyntheticVerificationOptions = {
  /** The running environment; only `local` and `test` are accepted. */
  readonly environment: string | undefined;
  /** The database the fixture will be applied to; must be loopback. */
  readonly databaseUrl: string;
  /** Company ids that count as verified. Anything else is NOT_VERIFIED. */
  readonly verifiedCompanyIds: readonly string[];
  /** Per-company overrides, for revocation and expiry scenarios. */
  readonly standings?:
    | Readonly<
        Record<
          string,
          {
            readonly founderIdentity?: VerificationClaimStanding | undefined;
            readonly organisationIdentity?:
              VerificationClaimStanding | undefined;
          }
        >
      >
    | undefined;
};

export function assertSyntheticVerificationPermitted(
  options: Pick<SyntheticVerificationOptions, "environment" | "databaseUrl">,
): void {
  if (
    options.environment === undefined ||
    !PERMITTED_ENVIRONMENTS.has(options.environment)
  ) {
    throw new SyntheticVerificationRefusedError(
      `CAPITAL_Q_ENV must be local or test (got ${options.environment ?? "unset"})`,
    );
  }
  let host: string;
  try {
    host = new URL(options.databaseUrl).hostname;
  } catch {
    throw new SyntheticVerificationRefusedError(
      "database URL is not parseable",
    );
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new SyntheticVerificationRefusedError(
      `database host must be loopback (got ${host})`,
    );
  }
}

export function createSyntheticVerificationClaimsPort(
  options: SyntheticVerificationOptions,
): VerificationClaimsPort {
  assertSyntheticVerificationPermitted(options);
  const verified = new Set(options.verifiedCompanyIds);
  const overrides = options.standings ?? {};
  return {
    sourceLabel: SYNTHETIC_VERIFICATION_SOURCE,
    currentStandings: (subject) => {
      const base: VerificationClaimStanding = verified.has(subject.companyId)
        ? "VERIFIED"
        : "NOT_VERIFIED";
      const override = overrides[subject.companyId];
      return Promise.resolve({
        available: true,
        founderIdentity: override?.founderIdentity ?? base,
        organisationIdentity: override?.organisationIdentity ?? base,
      });
    },
  };
}
