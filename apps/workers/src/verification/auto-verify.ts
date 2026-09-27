import {
  SYNTHETIC_AUTO_VERIFY_POLICY,
  syntheticAutoVerifyAttestation,
  type SyntheticAutoVerifySweepResult,
  type SyntheticDemoAttestation,
} from "@capital-q/verification";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * R43 on the hosted workers. Temporary until BIZ-006 /ops.
 * TODO(BIZ-006): delete this module and its two uses in main.ts; the
 * decider then goes back to holding the synthetic-demo allowance only.
 */

export type VerificationAttestationSource =
  "SYNTHETIC_DEMO_ALLOWANCE" | typeof SYNTHETIC_AUTO_VERIFY_POLICY.id | "NONE";

/**
 * The proof the worker's verification decider holds. The routing
 * allowance (local/test, or an attested staging project) wins when this
 * process has it; otherwise, on `staging` only, SYNTHETIC_AUTO_VERIFY_POLICY.
 * Reads no environment variable itself: the hosted workers carry neither
 * CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED nor the project ref, and must not.
 */
export function verificationAttestationFor(options: {
  readonly syntheticDemo: SyntheticDemoAttestation | null;
  readonly environment: string | undefined;
}): {
  readonly attestation: SyntheticDemoAttestation | null;
  readonly source: VerificationAttestationSource;
} {
  if (options.syntheticDemo !== null) {
    return {
      attestation: options.syntheticDemo,
      source: "SYNTHETIC_DEMO_ALLOWANCE",
    };
  }
  const policy = syntheticAutoVerifyAttestation(options.environment);
  return policy === null
    ? { attestation: null, source: "NONE" }
    : { attestation: policy, source: SYNTHETIC_AUTO_VERIFY_POLICY.id };
}

/**
 * Runs the sweep now and then every `intervalMs` until aborted, never two
 * at once. A failing sweep is logged and retried next interval; it never
 * takes the worker down. Each run logs `synthetic auto-verify sweep`.
 */
export async function runSyntheticAutoVerifySweeps(options: {
  readonly sweep: () => Promise<SyntheticAutoVerifySweepResult>;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  while (!options.signal.aborted) {
    try {
      const result = await options.sweep();
      options.logger.info(
        { policy: SYNTHETIC_AUTO_VERIFY_POLICY.id, ...result },
        "synthetic auto-verify sweep",
      );
    } catch (error: unknown) {
      options.logger.warn(
        { policy: SYNTHETIC_AUTO_VERIFY_POLICY.id, err: error },
        "synthetic auto-verify sweep failed; retrying next interval",
      );
    }
    await sleep(options.intervalMs, options.signal);
  }
}
