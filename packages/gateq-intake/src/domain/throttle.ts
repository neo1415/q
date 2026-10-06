/**
 * How much one guest session may do (CQ-GATE-002S §8).
 *
 * The applicant surface is the only anonymous write path in the product,
 * and a conversational one: every turn spends somebody else's model
 * budget. Bounding the shape of a request is not the same as bounding how
 * often it arrives, and GATE-002R only did the first.
 *
 * Three things make this safe to key on.
 *
 * **The key is earned, never given.** It is the server-issued id of a
 * session that has already been verified, so a caller cannot choose their
 * own bucket, and nothing replayable as a session ever reaches a counter,
 * a log line or a metric label. A forged credential fails verification
 * before it gets here, which means it buys no quota and leaves no bucket
 * to probe — charging first and verifying afterwards would have given an
 * attacker both.
 *
 * **One guest's quota is one guest's.** Buckets are per session and per
 * operation. A founder hammering submit exhausts their own allowance and
 * nobody else's; there is deliberately no global counter that a single
 * applicant could trip for everybody.
 *
 * **It forgets.** An unbounded Map with a public entry point is a memory
 * leak, so expired buckets are swept on write and the table is capped. Under the cap the oldest window goes first, which costs
 * an attacker their own oldest counter rather than anybody else's current
 * one.
 *
 * In process, on purpose: no Redis, no new service, no new credential.
 * Each API instance holds its own counters, which is a weaker bound than a
 * shared one and a much stronger bound than none. A distributed limiter is
 * a real thing to want and it is not this packet.
 */

/** What a guest can do, and what each costs them. */
export const GATEQ_GUEST_OPERATIONS = [
  /** A conversational turn. The expensive one: it reaches a model. */
  "TURN",
  /**
   * F1: saving the form's answers. No model is reached, but every save
   * re-runs the engine and a taxonomy lookup, so it is still counted.
   */
  "ANSWERS",
  /** Reading their own application back. Cheap, but not free. */
  "RESUME",
  /** Submitting. Idempotent, so a retry is not abuse — a flood is. */
  "SUBMIT",
  /** Asking for an upload authorisation. */
  "UPLOAD",
  /**
   * Opening a new application at one gateway (P7: the embed puts the door
   * on any website). There is no session yet, so this is charged to the
   * gateway's public id: a ceiling on how many conversations one gateway can
   * be made to open per window, which bounds the model spend a script
   * could run up against an investor's front door.
   */
  "START",
] as const;
export type GateQGuestOperation = (typeof GATEQ_GUEST_OPERATIONS)[number];

export type GuestQuota = {
  readonly limit: number;
  readonly windowMs: number;
};

/**
 * The default allowances.
 *
 * Set from what a real conversation looks like rather than from a round
 * number: a founder types a dozen thoughtful turns in ten minutes, not
 * sixty. Generous enough that nobody honest meets them, tight enough that
 * a script does within seconds.
 */
export const GATEQ_GUEST_QUOTAS: Readonly<
  Record<GateQGuestOperation, GuestQuota>
> = {
  TURN: { limit: 20, windowMs: 10 * 60_000 },
  ANSWERS: { limit: 40, windowMs: 10 * 60_000 },
  RESUME: { limit: 120, windowMs: 10 * 60_000 },
  SUBMIT: { limit: 5, windowMs: 10 * 60_000 },
  UPLOAD: { limit: 10, windowMs: 10 * 60_000 },
  START: { limit: 60, windowMs: 10 * 60_000 },
};

/** Beyond this many live buckets the oldest window is dropped. */
const MAX_TRACKED_SESSIONS = 20_000;

export type GuestThrottle = {
  /**
   * Charge one operation to this session.
   *
   * Returns false when the allowance is spent. The caller decides what
   * that means on the wire; this decides nothing about HTTP.
   */
  readonly charge: (input: {
    /**
     * The verified session's server-issued id. Not the credential and not
     * derived from it, so nothing replayable reaches a counter.
     */
    readonly sessionId: string;
    readonly operation: GateQGuestOperation;
  }) => boolean;
  /** Live bucket count, for a test or a gauge. Never the keys. */
  readonly size: () => number;
};

type Bucket = { count: number; resetAt: number };

export function createGuestThrottle(options?: {
  readonly quotas?: Readonly<Record<GateQGuestOperation, GuestQuota>>;
  readonly clock?: () => number;
  readonly maxTracked?: number;
}): GuestThrottle {
  const quotas = options?.quotas ?? GATEQ_GUEST_QUOTAS;
  const clock = options?.clock ?? (() => Date.now());
  const maxTracked = options?.maxTracked ?? MAX_TRACKED_SESSIONS;
  const buckets = new Map<string, Bucket>();

  /** Drop what has expired; if still over the cap, drop the oldest windows. */
  const sweep = (now: number): void => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size <= maxTracked) return;
    const byAge = [...buckets.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    for (const [key] of byAge.slice(0, buckets.size - maxTracked)) {
      buckets.delete(key);
    }
  };

  return {
    charge: ({ sessionId, operation }) => {
      const quota = quotas[operation];
      const now = clock();
      // Operation in the key: spending a turn allowance must not spend a
      // submit allowance, or a long conversation would lock the applicant
      // out of finishing it.
      const key = `${operation}:${sessionId}`;
      const bucket = buckets.get(key);

      if (bucket === undefined || bucket.resetAt <= now) {
        if (buckets.size >= maxTracked) sweep(now);
        buckets.set(key, { count: 1, resetAt: now + quota.windowMs });
        return true;
      }
      if (bucket.count >= quota.limit) return false;
      bucket.count += 1;
      return true;
    },

    size: () => buckets.size,
  };
}
