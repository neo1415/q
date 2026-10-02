import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * ADMIN-4 (founder direction 2026-10-02): verification is requested
 * automatically for organisations on the network. The first run at startup
 * is the backfill (existing visible organisations with no claim); later
 * runs pick up organisations as they complete onboarding, turn
 * network-visible or add a pitch. Every request goes through the
 * verification service; a failed run is logged and retried next interval.
 */
export async function runAutoVerificationRequests(options: {
  readonly sweep: () => Promise<{
    readonly considered: number;
    readonly requested: number;
    readonly failed: number;
  }>;
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
      if (result.considered > 0) {
        options.logger.info({ ...result }, "verification auto-request sweep");
      }
    } catch (error: unknown) {
      options.logger.warn(
        { err: error },
        "verification auto-request sweep failed; retrying next interval",
      );
    }
    await sleep(options.intervalMs, options.signal);
  }
}
