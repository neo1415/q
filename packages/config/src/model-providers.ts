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
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY2",
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

/**
 * The operator's opt-in for synthetic-demo model routing (doc 15 §62,
 * CQ-REC-007). Off unless set to `true`. Setting it is a claim about the
 * DATA this deployment holds — that every founder, investor and company in
 * it was invented for a demonstration — and the claim is checked again,
 * against the environment and the database, by
 * `createSyntheticDemoRoutingAllowance`, which refuses to build an
 * allowance anywhere it cannot hold. Parsing it here grants nothing.
 */
const syntheticDemoRouting = z
  .preprocess(
    (value) => (value === undefined || value === "" ? "false" : value),
    z.enum(["true", "false"]),
  )
  .transform((value) => value === "true");

export const modelProviderEnvShape = {
  CQ_SYNTHETIC_DEMO_ROUTING: syntheticDemoRouting,
  /**
   * The deployment's own statement that everything it holds was invented
   * (QX-004 §0.3). Server-only: no HTTP contract carries it and no browser
   * can set it. Meaningless without the routing opt-in beside it, refused
   * outright in preview and production, and in staging it must name the
   * synthetic Supabase project below.
   */
  CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED: syntheticDemoRouting,
  /** The Supabase project that attestation is about; must be the one in use. */
  CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF: z
    .string()
    .trim()
    .min(16)
    .max(64)
    .optional(),
  GEMINI_API_KEY: apiKey.optional(),
  // Further Gemini keys. The adapter rotates to the next one when a key
  // is rate-limited, so one exhausted free tier does not stop Q. Both
  // spellings are accepted because the second key was already in use
  // without the underscore before this was configurable.
  GEMINI_API_KEY_2: apiKey.optional(),
  GEMINI_API_KEY2: apiKey.optional(),
  GROQ_API_KEY: apiKey.optional(),
  // Further GroqCloud keys. The adapter rotates to the next one when a key
  // is rate-limited, so one exhausted free tier does not stop Q.
  GROQ_API_KEY_2: apiKey.optional(),
  GROQ_API_KEY_3: apiKey.optional(),
  GROQ_API_KEY_4: apiKey.optional(),
};

export type ModelProviderSecrets = {
  /**
   * The operator asked this deployment to route attested synthetic demo
   * material by doc 15 §62. Not a secret and not authority: the gateway
   * honours it only through an allowance that re-checks the deployment.
   */
  readonly syntheticDemoRouting: boolean;
  /** The deployment attests its material is invented (QX-004 §0.3). */
  readonly syntheticDemoAttested: boolean;
  /** The Supabase project that attestation names, if any. */
  readonly syntheticDemoProjectRef: string | undefined;
  /** Google Gemini Developer API; absent means the adapter is not configured. */
  readonly google: ProviderCredential | undefined;
  /** Every Gemini key in order, the first being `google`; empty when unconfigured. */
  readonly googleKeys: readonly ProviderCredential[];
  /** GroqCloud; absent means the adapter is not configured. */
  readonly groq: ProviderCredential | undefined;
  /** Every GroqCloud key in order, the first being `groq`; empty when unconfigured. */
  readonly groqKeys: readonly ProviderCredential[];
};

export type ModelProviderConfigStatus = {
  readonly syntheticDemoRouting: boolean;
  readonly google: "configured" | "unconfigured";
  /** How many Gemini keys rotate; never which. */
  readonly googleKeys: number;
  readonly groq: "configured" | "unconfigured";
  /** How many GroqCloud keys rotate; never which. */
  readonly groqKeys: number;
};

export function toModelProviderSecrets(parsed: {
  readonly CQ_SYNTHETIC_DEMO_ROUTING?: boolean | undefined;
  readonly CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED?: boolean | undefined;
  readonly CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF?: string | undefined;
  readonly GEMINI_API_KEY?: string | undefined;
  readonly GEMINI_API_KEY_2?: string | undefined;
  readonly GEMINI_API_KEY2?: string | undefined;
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
  const googleKeys = [
    parsed.GEMINI_API_KEY,
    parsed.GEMINI_API_KEY_2 ?? parsed.GEMINI_API_KEY2,
  ]
    .filter((key): key is string => key !== undefined)
    .map((key) => new ProviderCredential(key));
  return {
    syntheticDemoRouting: parsed.CQ_SYNTHETIC_DEMO_ROUTING ?? false,
    syntheticDemoAttested: parsed.CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED ?? false,
    syntheticDemoProjectRef: parsed.CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF,
    google: googleKeys[0],
    googleKeys,
    groq: groqKeys[0],
    groqKeys,
  };
}

/** Safe to log: which adapters exist, never what they hold. */
export function modelProviderConfigStatus(
  secrets: ModelProviderSecrets,
): ModelProviderConfigStatus {
  return {
    syntheticDemoRouting: secrets.syntheticDemoRouting,
    google: secrets.google === undefined ? "unconfigured" : "configured",
    groq: secrets.groq === undefined ? "unconfigured" : "configured",
    googleKeys: secrets.googleKeys.length,
    groqKeys: secrets.groqKeys.length,
  };
}
