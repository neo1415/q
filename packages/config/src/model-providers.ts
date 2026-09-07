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
};

export type ModelProviderSecrets = {
  /** Google Gemini Developer API; absent means the adapter is not configured. */
  readonly google: ProviderCredential | undefined;
  /** GroqCloud; absent means the adapter is not configured. */
  readonly groq: ProviderCredential | undefined;
};

export type ModelProviderConfigStatus = {
  readonly google: "configured" | "unconfigured";
  readonly groq: "configured" | "unconfigured";
};

export function toModelProviderSecrets(parsed: {
  readonly GEMINI_API_KEY?: string | undefined;
  readonly GROQ_API_KEY?: string | undefined;
}): ModelProviderSecrets {
  return {
    google:
      parsed.GEMINI_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.GEMINI_API_KEY),
    groq:
      parsed.GROQ_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.GROQ_API_KEY),
  };
}

/** Safe to log: which adapters exist, never what they hold. */
export function modelProviderConfigStatus(
  secrets: ModelProviderSecrets,
): ModelProviderConfigStatus {
  return {
    google: secrets.google === undefined ? "unconfigured" : "configured",
    groq: secrets.groq === undefined ? "unconfigured" : "configured",
  };
}
