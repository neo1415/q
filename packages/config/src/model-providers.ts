import { z } from "zod";

/**
 * Model provider credentials (doc 12 §65; doc 21 §139-142; CQ-Q-005).
 *
 * The single place the two V1 provider keys are read from the
 * environment. Each is OPTIONAL: a service starts with whichever
 * providers are configured and the Model Gateway routes around the rest
 * (packet §27, §58). Neither key is ever public, and neither belongs to
 * the browser, the database, a log, a prompt or a test fixture.
 *
 * A key is wrapped in `ProviderCredential` so that the value cannot be
 * stringified or serialised by accident: JSON.stringify(config) and
 * `${credential}` both yield "[redacted]". The provider adapter reads it
 * once, at composition, through `reveal()`.
 */

export const MODEL_PROVIDER_ENV_NAMES = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
] as const;

const REDACTED = "[redacted]";

export class ProviderCredential {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The only way to the value. Call at composition, never in a log path. */
  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/**
 * Keys are opaque strings of a vendor's choosing; the only validation that
 * does not embed a vendor's format is "present and not obviously blank".
 */
const apiKey = z
  .string()
  .trim()
  .min(16, "expected a provider API key")
  .max(512, "expected a provider API key");

export const modelProviderEnvShape = {
  GEMINI_API_KEY: apiKey.optional(),
  GROQ_API_KEY: apiKey.optional(),
  // Further GroqCloud keys. The adapter rotates to the next one when a key
  // is rate-limited, so one exhausted free tier does not stop Q.
  GROQ_API_KEY_2: apiKey.optional(),
  GROQ_API_KEY_3: apiKey.optional(),
  GROQ_API_KEY_4: apiKey.optional(),
};

export type ModelProviderSecrets = {
  /** Google Gemini Developer API; absent means the adapter is not configured. */
  readonly google: ProviderCredential | undefined;
  /** GroqCloud; absent means the adapter is not configured. */
  readonly groq: ProviderCredential | undefined;
  /** Every GroqCloud key in order, the first being `groq`; empty when unconfigured. */
  readonly groqKeys: readonly ProviderCredential[];
};

export type ModelProviderConfigStatus = {
  readonly google: "configured" | "unconfigured";
  readonly groq: "configured" | "unconfigured";
  /** How many GroqCloud keys rotate; never which. */
  readonly groqKeys: number;
};

export function toModelProviderSecrets(parsed: {
  readonly GEMINI_API_KEY?: string | undefined;
  readonly GROQ_API_KEY?: string | undefined;
  readonly GROQ_API_KEY_2?: string | undefined;
  readonly GROQ_API_KEY_3?: string | undefined;
  readonly GROQ_API_KEY_4?: string | undefined;
}): ModelProviderSecrets {
  const groqKeys = [
    parsed.GROQ_API_KEY,
    parsed.GROQ_API_KEY_2,
    parsed.GROQ_API_KEY_3,
    parsed.GROQ_API_KEY_4,
  ]
    .filter((key): key is string => key !== undefined)
    .map((key) => new ProviderCredential(key));
  return {
    google:
      parsed.GEMINI_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.GEMINI_API_KEY),
    groq: groqKeys[0],
    groqKeys,
  };
}

/** Safe to log: which adapters exist, never what they hold. */
export function modelProviderConfigStatus(
  secrets: ModelProviderSecrets,
): ModelProviderConfigStatus {
  return {
    google: secrets.google === undefined ? "unconfigured" : "configured",
    groq: secrets.groq === undefined ? "unconfigured" : "configured",
    groqKeys: secrets.groqKeys.length,
  };
}
