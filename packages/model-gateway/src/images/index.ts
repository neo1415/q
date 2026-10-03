import type { ModelFailureClass } from "@capital-q/contracts";

import { ModelProviderFailure } from "../errors.js";
import type { ModelUsageRepository } from "../ports.js";

/**
 * Image generation through the Q Model Gateway (DOCS; ADR 0031 addendum).
 *
 * The same boundary as text: feature code never calls an image provider.
 * It asks this gateway for an IMAGE_GENERATION, which tries the configured
 * adapters in order, bounds each attempt in time, accepts only PNG or JPEG
 * bytes within a size cap, and records every attempt in ai_ops.model_usage
 * with its estimated cost. Budgets (per document, per organisation per
 * day, platform-wide per day) are the caller's, counted from the
 * provenance table; this gateway enforces only what it can see: a kill
 * switch and one image per call.
 *
 * What a prompt may carry is the caller's contract (the document studio
 * builds it from the slide title, the deck's one-line description and
 * brand colours, with standing exclusions: no text, no logos, no real
 * people). This module adds the same exclusions again as a suffix the
 * caller cannot drop.
 */

export const IMAGE_GENERATION_TASK_CLASS = "IMAGE_GENERATION" as const;

/** What every prompt ends with, whoever built it. */
export const IMAGE_PROMPT_EXCLUSIONS =
  "No text, letters, numbers, logos, brand marks or trademarks of any company. No real or identifiable people and no likeness of any real person; if people appear they are anonymous, small and seen from a distance. No charts or figures.";

export const IMAGE_BYTES_MAX = 5 * 1024 * 1024;
export const IMAGE_PROMPT_MAX = 1_200;

export type ImageShape = "LANDSCAPE" | "SQUARE";

export type ImageProviderRequest = {
  readonly modelCode: string;
  readonly prompt: string;
  readonly shape: ImageShape;
};

export type GeneratedImage = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/png" | "image/jpeg";
};

/** One vendor's image endpoint, behind the adapter pattern. */
export type ImageProvider = {
  readonly code: string;
  readonly modelCode: string;
  /** Catalog ids for the usage row (ai_ops.providers / ai_ops.models). */
  readonly providerId: string;
  readonly modelId: string;
  /** Estimated USD per image, for the usage row and budgets. */
  readonly costPerImageUsd: number;
  readonly generate: (
    request: ImageProviderRequest,
    context: { readonly signal: AbortSignal },
  ) => Promise<GeneratedImage>;
};

export type ImageGatewayRequest = {
  readonly prompt: string;
  readonly shape: ImageShape;
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly qRunId?: string | undefined;
    readonly correlationId?: string | undefined;
  };
  readonly signal?: AbortSignal | undefined;
};

export type ImageGatewayResult =
  | {
      readonly status: "GENERATED";
      readonly image: GeneratedImage;
      readonly providerCode: string;
      readonly modelCode: string;
      readonly prompt: string;
      readonly costUsd: number;
    }
  | { readonly status: "UNAVAILABLE" | "FAILED" };

export type ImageGateway = {
  readonly enabled: boolean;
  readonly generate: (
    request: ImageGatewayRequest,
  ) => Promise<ImageGatewayResult>;
};

/** PNG or JPEG by magic bytes, else null. */
export function imageContentType(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | null {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** The prompt actually sent: bounded, with the exclusions appended. */
export function finalImagePrompt(prompt: string): string {
  const body = prompt.replace(/\s+/g, " ").trim();
  const room = IMAGE_PROMPT_MAX - IMAGE_PROMPT_EXCLUSIONS.length - 1;
  return `${body.slice(0, Math.max(0, room))} ${IMAGE_PROMPT_EXCLUSIONS}`;
}

function failureClassOf(error: unknown): ModelFailureClass {
  if (error instanceof ModelProviderFailure) return error.failureClass;
  if (error instanceof Error && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof Error && error.name === "AbortError") return "CANCELLED";
  return "TRANSIENT";
}

export function createImageGateway(options: {
  /** In route order; empty or `enabled: false` means no images. */
  readonly providers: readonly ImageProvider[];
  readonly enabled: boolean;
  readonly usage?: ModelUsageRepository | undefined;
  readonly attemptTimeoutMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}): ImageGateway {
  const timeoutMs = options.attemptTimeoutMs ?? 60_000;
  const now = options.now ?? Date.now;
  const enabled = options.enabled && options.providers.length > 0;
  return {
    enabled,
    generate: async (request) => {
      if (!enabled) return { status: "UNAVAILABLE" };
      const prompt = finalImagePrompt(request.prompt);
      let attempt = 0;
      for (const provider of options.providers) {
        attempt += 1;
        const started = now();
        const signal =
          request.signal === undefined
            ? AbortSignal.timeout(timeoutMs)
            : AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
        let failure: ModelFailureClass | undefined;
        let image: GeneratedImage | undefined;
        try {
          const produced = await provider.generate(
            { modelCode: provider.modelCode, prompt, shape: request.shape },
            { signal },
          );
          const type = imageContentType(produced.bytes);
          if (
            type === null ||
            produced.bytes.byteLength > IMAGE_BYTES_MAX ||
            produced.bytes.byteLength < 8
          ) {
            failure = "INVALID_MODEL_OUTPUT";
          } else {
            image = { bytes: produced.bytes, contentType: type };
          }
        } catch (error) {
          failure = failureClassOf(error);
        }
        await options.usage
          ?.record({
            tenantId: request.attribution.tenantId,
            userId: request.attribution.userId,
            // Illustrations are for documents, whatever run asked.
            purpose: "DOCUMENT",
            qRunId: request.attribution.qRunId,
            taskClass: IMAGE_GENERATION_TASK_CLASS,
            providerId: provider.providerId,
            modelId: provider.modelId,
            routingPolicyId: undefined,
            attempt: Math.min(attempt, 6),
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            latencyMs: Math.max(0, Math.round(now() - started)),
            // A refused or failed image is not billed by either vendor.
            costUsd: image === undefined ? 0 : provider.costPerImageUsd,
            costBasis: "ESTIMATED",
            success: image !== undefined,
            errorCode:
              image === undefined ? (failure ?? "TRANSIENT") : undefined,
            correlationId: request.attribution.correlationId,
          })
          .catch(() => undefined);
        if (image !== undefined) {
          return {
            status: "GENERATED",
            image,
            providerCode: provider.code,
            modelCode: provider.modelCode,
            prompt,
            costUsd: provider.costPerImageUsd,
          };
        }
        if (failure === "CANCELLED") break;
      }
      return { status: "FAILED" };
    },
  };
}

/** Tests and local stacks: a provider that answers from a function. */
export function createFakeImageProvider(
  answer: (request: ImageProviderRequest) => Promise<GeneratedImage>,
  overrides: Partial<Omit<ImageProvider, "generate">> = {},
): ImageProvider {
  return {
    code: "fake",
    modelCode: "fake-image",
    providerId: "a1000000-0000-4000-8000-0000000000ff",
    modelId: "a2000000-0000-4000-8000-0000000000ff",
    costPerImageUsd: 0,
    ...overrides,
    generate: (request) => answer(request),
  };
}
