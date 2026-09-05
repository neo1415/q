/**
 * The stable internal error taxonomy every provider adapter maps onto
 * (doc 22 §141).
 *
 * A Google 403, a DeepSeek 429 and a Cloudflare error code are three ways of
 * saying one of four things. Product code reacts to these four; it never
 * learns a vendor's codes, because the day the vendor is replaced every
 * `if (code === 10004)` becomes a silent bug.
 *
 * The vendor's own code and message are diagnostic material for private
 * observability. They are carried here in `providerCode` so an adapter can
 * log them deliberately — never interpolated into a user-facing message, and
 * never treated as a contract.
 */

export const PROVIDER_ERROR_KINDS = [
  /** The adapter's own credential was rejected. Never the user's problem. */
  "AUTHENTICATION",
  /** The provider asked us to slow down. Retryable with backoff. */
  "RATE_LIMIT",
  /** The provider is down, timing out or erroring. Retryable. */
  "UNAVAILABLE",
  /** The provider refused what we sent. Retrying it unchanged cannot help. */
  "VALIDATION",
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export type ProviderErrorOptions = {
  /** The adapter's provider name, e.g. a video or calendar provider code. */
  readonly provider: string;
  /** The vendor's own code, kept for private diagnostics only. */
  readonly providerCode?: string | undefined;
  readonly cause?: unknown;
};

export abstract class ProviderError extends Error {
  abstract readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly providerCode: string | undefined;
  /** True when another attempt could plausibly succeed. */
  abstract readonly retryable: boolean;

  constructor(message: string, options: ProviderErrorOptions) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = new.target.name;
    this.provider = options.provider;
    this.providerCode = options.providerCode;
  }
}

export class ProviderAuthenticationError extends ProviderError {
  readonly kind = "AUTHENTICATION" as const;
  readonly retryable = false;
}

export class ProviderRateLimitError extends ProviderError {
  readonly kind = "RATE_LIMIT" as const;
  readonly retryable = true;
  /** Seconds the provider asked us to wait, when it said so. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    options: ProviderErrorOptions & {
      readonly retryAfterSeconds?: number | undefined;
    },
  ) {
    super(message, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ProviderUnavailableError extends ProviderError {
  readonly kind = "UNAVAILABLE" as const;
  readonly retryable = true;
}

export class ProviderValidationError extends ProviderError {
  readonly kind = "VALIDATION" as const;
  readonly retryable = false;
}
