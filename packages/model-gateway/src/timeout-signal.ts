/**
 * W4-G (audit finding 9): a seam for "abort after this long".
 *
 * Production uses the platform's own `AbortSignal.timeout`, unchanged: it
 * aborts with a TimeoutError and keeps nothing alive. That timer is the
 * runtime's, so a test on fake time cannot move it; a test passes
 * `timerTimeoutSignal` instead, which aborts with the same TimeoutError
 * from the global `setTimeout` that fake timers drive.
 */
export type TimeoutSignal = (ms: number) => AbortSignal;

/** The default everywhere: the platform's own timeout signal. */
export const nativeTimeoutSignal: TimeoutSignal = (ms) =>
  AbortSignal.timeout(ms);

/** For tests on fake time: the same abort, from a `setTimeout` timer. */
export const timerTimeoutSignal: TimeoutSignal = (ms) => {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
  }, ms);
  return controller.signal;
};

// Moved unchanged from gateway.ts (W4-G), beside the other timer.
/** Settles when `promise` does, `ms` passes, or `signal` aborts. Never rejects. */
export function waitAtMost(
  promise: Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
    promise.then(done, done);
  });
}
