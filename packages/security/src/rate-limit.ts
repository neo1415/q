/**
 * W1-A (enterprise audit 21 Nov 2026, finding 2): a general rate limit for
 * the API services, beside the tighter ones some routes already have (the
 * GateQ guest throttle, voice and research budgets), which are unchanged.
 *
 * Generous by design: it is a backstop against a runaway client or a
 * flood, never a product quota. A signed-in request is counted per person
 * (their server-resolved user id); a request with no person is counted per
 * client address. The web server calls the API on its people's behalf from
 * one address, so an address is only ever the key for anonymous traffic.
 *
 * Fixed one-minute windows in memory, per instance: simple, bounded, and
 * enough for a backstop (a few instances multiply the allowance, which is
 * acceptable for a ceiling this generous). Pure and clock-injected.
 */
export type GeneralRateLimits = {
  /** Requests per window for one signed-in person. */
  readonly perUser: number;
  /** Requests per window for one client address with no person. */
  readonly perAddress: number;
  readonly windowMs: number;
};

export const DEFAULT_GENERAL_RATE_LIMITS: GeneralRateLimits = {
  perUser: 600,
  perAddress: 300,
  windowMs: 60_000,
};

/** At most this many keys are tracked; the oldest windows go first. */
export const RATE_LIMIT_MAX_KEYS = 50_000;

export type RateLimitVerdict =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export type GeneralRateLimiter = {
  readonly take: (subject: {
    /** The server-resolved person, or null when there is none. */
    readonly userId: string | null;
    /** The client address, as the service's own resolution gives it. */
    readonly address: string;
  }) => RateLimitVerdict;
};

export function createGeneralRateLimiter(
  limits: GeneralRateLimits = DEFAULT_GENERAL_RATE_LIMITS,
  now: () => number = Date.now,
): GeneralRateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take: (subject) => {
      const key =
        subject.userId === null
          ? `address:${subject.address}`
          : `user:${subject.userId}`;
      const limit =
        subject.userId === null ? limits.perAddress : limits.perUser;
      const at = now();
      const start = at - (at % limits.windowMs);
      let window = windows.get(key);
      if (window === undefined || window.start !== start) {
        window = { start, count: 0 };
        windows.delete(key);
        windows.set(key, window);
        while (windows.size > RATE_LIMIT_MAX_KEYS) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      if (window.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((start + limits.windowMs - at) / 1_000),
          ),
        };
      }
      window.count += 1;
      return { allowed: true, remaining: limit - window.count };
    },
  };
}
