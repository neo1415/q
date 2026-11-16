/**
 * A bound on a read the turn waits for before it asks a model (16 Nov
 * 2026). On the transaction-pooler trial the turn reader awaited the
 * situation and conversation-state reads, one never returned, and nothing
 * timed it out: the run hung. Each such read now has a deadline; past it
 * the turn goes on without that read, exactly as it does when the read
 * fails, and says so in the log.
 */

/**
 * How long the turn waits for its situation header or conversation state.
 * Healthy reads take 0.19-0.41 s on hosted (live 16 Nov); 5 s is far past
 * that and still leaves the answer room inside the run's own deadline.
 */
export const TURN_READ_DEADLINE_MS = 5_000;

export class ReadDeadlineError extends Error {
  readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`read did not finish within ${String(deadlineMs)} ms`);
    this.name = "ReadDeadlineError";
    this.deadlineMs = deadlineMs;
  }
}

/**
 * `read`, or a ReadDeadlineError once `deadlineMs` passes. The read itself
 * is not stopped (the database layer bounds it); only the wait for it is.
 */
export function withinDeadline<T>(
  read: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ReadDeadlineError(deadlineMs));
    }, deadlineMs);
    read.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
