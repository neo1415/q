/**
 * Reads that survive a bad network (P9).
 *
 * A phone on a train drops packets, stalls for seconds and goes offline
 * between stations. Every client read built on this module therefore:
 *
 * - gives up waiting after a bounded time (never an infinite spinner);
 * - retries a failure that looks like the network, with exponential
 *   backoff and full jitter so a reconnecting crowd does not stampede;
 * - while the browser says it is offline, waits for `online` instead of
 *   burning attempts against a dead line;
 * - never retries an answer: a server that replied "no" is not a network
 *   failure, and repeating a refused read would only repeat the refusal.
 *
 * Server actions cannot be cancelled once sent, so a timeout here stops
 * the waiting, not the request. Only reads go through `retryWithBackoff`;
 * consequential writes keep their own idempotency keys and are never
 * blindly resent from here.
 */

export class ReadTimeoutError extends Error {
  readonly ms: number;
  constructor(ms: number) {
    super(`No answer within ${String(ms)} ms.`);
    this.name = "ReadTimeoutError";
    this.ms = ms;
  }
}

export class ReadAbortedError extends Error {
  constructor() {
    super("The read was cancelled.");
    this.name = "ReadAbortedError";
  }
}

/** Resolves with `work`, or rejects with ReadTimeoutError after `ms`. */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ReadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new ReadTimeoutError(ms));
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new ReadAbortedError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Full-jitter exponential backoff: a random wait in [0, min(max, base*2^n)].
 * `attempt` counts retries from 0.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * Math.min(1, Math.max(0, random())));
}

export type RetryPhase = "retrying" | "offline";

export type RetryOptions = {
  /** Total tries, the first included. Default 3. */
  readonly attempts?: number;
  /** Per-try time limit. Default 15 s. */
  readonly timeoutMs?: number;
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly signal?: AbortSignal;
  /** Which failures are worth another try. Default: network-looking ones. */
  readonly shouldRetry?: (error: unknown) => boolean;
  /** Told before each wait, so a screen can say "Retrying" or "Offline". */
  readonly onRetry?: (phase: RetryPhase, attempt: number) => void;
  /** Injected in tests. */
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly isOnline?: () => boolean;
  readonly waitForOnline?: (signal?: AbortSignal) => Promise<void>;
};

/**
 * Whether a failure looks like the network rather than an answer: a
 * timeout, a fetch that never connected, or the opaque error a server
 * action throws when its response never arrives.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof ReadAbortedError) return false;
  if (error instanceof ReadTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "TypeError") return true;
  return /failed to fetch|network|load failed|fetch failed|unexpected response|connection|timed? ?out/i.test(
    error.message,
  );
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ReadAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ReadAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function untilOnline(signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || browserOnline()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener("online", done);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      window.removeEventListener("online", done);
      reject(new ReadAbortedError());
    };
    window.addEventListener("online", done);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs a read, retrying network failures with backoff. While offline it
 * waits for the connection (that wait does not spend an attempt).
 */
export async function retryWithBackoff<T>(
  read: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? isNetworkFailure;
  const wait = options.sleep ?? sleep;
  const online = options.isOnline ?? browserOnline;
  const reconnect = options.waitForOnline ?? untilOnline;
  let attempt = 0;
  for (;;) {
    if (options.signal?.aborted === true) throw new ReadAbortedError();
    if (!online()) {
      options.onRetry?.("offline", attempt);
      await reconnect(options.signal);
    }
    try {
      return await withTimeout(read(attempt), timeoutMs, options.signal);
    } catch (error) {
      attempt += 1;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      options.onRetry?.(online() ? "retrying" : "offline", attempt);
      await wait(
        backoffDelay(attempt - 1, baseMs, maxMs, options.random),
        options.signal,
      );
    }
  }
}
