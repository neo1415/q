/**
 * Which image model each adapter runs, and what one image costs (Q room
 * W5, R8). One place, so a model retirement is a config change rather
 * than a hunt for constants: gemini-2.5-flash-image was retired and its
 * named replacement is the 3.1 flash-lite image model (Nano Banana 2
 * Lite, $0.034 per 1K image; research 2026-10-06 §5.3).
 *
 * The catalog ids are the ai_ops.models rows the usage ledger references;
 * a new model code is a new catalog row (migration), never an edit of the
 * old one, so earlier usage rows still name the model that ran.
 */
export type ImageModelConfig = {
  readonly modelCode: string;
  /** Estimated USD per 1K image, recorded on every usage row. */
  readonly costPerImageUsd: number;
  readonly providerId: string;
  readonly modelId: string;
};

export const IMAGE_MODEL_CONFIG = {
  google: {
    modelCode: "gemini-3.1-flash-lite-image",
    costPerImageUsd: 0.034,
    providerId: "a1000000-0000-4000-8000-000000000001",
    modelId: "a2000000-0000-4000-8000-000000000022",
  },
  openai: {
    modelCode: "gpt-image-1",
    // Medium quality, 1536x1024: about four US cents an image.
    costPerImageUsd: 0.04,
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000020",
  },
} as const satisfies Readonly<Record<string, ImageModelConfig>>;

/**
 * Generated images per deck or document, whatever the budgets allow
 * (founder direction 2026-10-06). Stock photos and placeholders fill the
 * rest.
 */
export const GENERATED_IMAGES_PER_DOCUMENT_MAX = 6;

/**
 * How long a billing or quota refusal switches generation off for this
 * process. A refused key is not retried picture by picture: the deck
 * falls back to stock photos and placeholders at once.
 */
export const IMAGE_BILLING_COOLDOWN_MS = 30 * 60 * 1000;
