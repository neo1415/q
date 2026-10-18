import type { CorrelationId } from "@capital-q/contracts";

import type {
  DecideSyntheticCommand,
  DecideSyntheticOutcome,
} from "./decide-synthetic.js";
import type { PendingSyntheticClaimSource } from "./ports.js";

/**
 * R43 sweep: offer every PENDING synthetic request to the ordinary decider.
 * Temporary until BIZ-006 /ops. TODO(BIZ-006): delete with
 * SYNTHETIC_AUTO_VERIFY_POLICY.
 *
 * It exists for requests recorded before the workers could decide them
 * (the earlier seed) and for any whose event was consumed while the
 * decider still refused. Bounded by `limit` per run; idempotent because
 * the decider re-reads the request under its organisation lock and a
 * decided request is no longer current. The source only narrows the
 * candidates; the decider re-checks every condition itself.
 */

export type SyntheticAutoVerifySweepResult = {
  readonly considered: number;
  readonly verified: number;
  readonly nothingToDecide: number;
  readonly refused: Readonly<Record<string, number>>;
  readonly failed: number;
};

export function createSyntheticAutoVerifySweep(dependencies: {
  readonly source: PendingSyntheticClaimSource;
  readonly decide: (
    command: DecideSyntheticCommand,
  ) => Promise<DecideSyntheticOutcome>;
  readonly correlation: () => CorrelationId;
  /** Most requests considered per run. */
  readonly limit: number;
  /** A failed decision is counted and the sweep moves on. */
  readonly onFailure?: ((claimId: string, error: unknown) => void) | undefined;
}) {
  const { source, decide, correlation, limit, onFailure } = dependencies;
  return async (): Promise<SyntheticAutoVerifySweepResult> => {
    const candidates = await source.pendingSyntheticClaims(limit);
    let verified = 0;
    let nothingToDecide = 0;
    let failed = 0;
    const refused: Record<string, number> = {};
    for (const candidate of candidates) {
      try {
        const outcome = await decide({
          tenantId: candidate.tenantId,
          claimId: candidate.claimId,
          correlationId: correlation(),
        });
        if (outcome.kind === "VERIFIED") verified += 1;
        else if (outcome.kind === "NOTHING_TO_DECIDE") nothingToDecide += 1;
        else refused[outcome.reason] = (refused[outcome.reason] ?? 0) + 1;
      } catch (error: unknown) {
        failed += 1;
        onFailure?.(candidate.claimId, error);
      }
    }
    return {
      considered: candidates.length,
      verified,
      nothingToDecide,
      refused,
      failed,
    };
  };
}
