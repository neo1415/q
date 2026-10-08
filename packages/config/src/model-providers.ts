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
// An empty variable means "not configured" (e.g. OPENAI_API_KEY= in a local
// launch env to keep a paid provider out of development traffic), so the
// gateway routes around it instead of the service refusing to start.
const apiKey = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .trim()
    .min(16, "expected a provider API key")
    .max(512, "expected a provider API key")
    .optional(),
);

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
  /**
   * OpenAI. Added for diagnosis (QX-004 core gate); since
   * 20261008130000_ai_ops_openai_primary.sql it is the primary text
   * provider: every routing policy names gpt-5.6-luna first. Without
   * this key every request falls to the Gemini and Groq fallbacks. The
   * adapter runs one model and refuses every other.
   */
  OPENAI_API_KEY: apiKey.optional(),
  // Both spellings, as the Gemini keys already are: the key was in use
  // under this name before it was configurable.
  OPEN_AI_API_KEY: apiKey.optional(),
  /**
   * Put one provider's models first, for a deployment that is diagnosing
   * rather than serving. Named by code (`openai`). Absent is the ordinary
   * case and the production one.
   */
  CQ_TEST_MODEL_PROVIDER: z.string().trim().max(32).optional(),
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
  /** OpenAI, diagnostic only; absent means the adapter is not configured. */
  readonly openai: ProviderCredential | undefined;
  /** Which provider a diagnosing deployment asked to try first, if any. */
  readonly testProviderCode: string | undefined;
};

export type ModelProviderConfigStatus = {
  readonly syntheticDemoRouting: boolean;
  readonly openai: "configured" | "unconfigured";
  /** Named only when a deployment asked to diagnose; never in production. */
  readonly testProvider: string | undefined;
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
  readonly OPENAI_API_KEY?: string | undefined;
  readonly OPEN_AI_API_KEY?: string | undefined;
  readonly CQ_TEST_MODEL_PROVIDER?: string | undefined;
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
    openai: ((key) =>
      key === undefined ? undefined : new ProviderCredential(key))(
      parsed.OPENAI_API_KEY ?? parsed.OPEN_AI_API_KEY,
    ),
    testProviderCode: parsed.CQ_TEST_MODEL_PROVIDER,
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
    openai: secrets.openai === undefined ? "unconfigured" : "configured",
    testProvider: secrets.testProviderCode,
  };
}
