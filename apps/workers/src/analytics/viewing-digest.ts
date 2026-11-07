import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Q Workspace §8 A6: the weekly passive-viewing digest for founders. The
 * admin setting passive_view_notifications decides whether anything is
 * sent (OFF by default); the digest itself is aggregate only, above the
 * floor, once per company and week (its dedupe key), so checking hourly
 * sends each week's notice once, soon after the week completes.
 */
export async function runViewingDigest(options: {
  readonly digest: (input: { readonly now: Date }) => Promise<number>;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly now?: (() => Date) | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? (() => new Date());
  while (!options.signal.aborted) {
    try {
      const sent = await options.digest({ now: now() });
      if (sent > 0) options.logger.info({ sent }, "viewing digest sent");
    } catch (error: unknown) {
      options.logger.warn(
        { err: error },
        "viewing digest failed; retrying next interval",
      );
    }
    await sleep(options.intervalMs, options.signal);
  }
}
