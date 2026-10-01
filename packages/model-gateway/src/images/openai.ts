import { ModelProviderFailure } from "../errors.js";
import type { GeneratedImage, ImageProvider } from "./index.js";

/**
 * OpenAI's image endpoint behind the image adapter (DOCS). One model,
 * medium quality, one image per call: the account is the founder's and an
 * accidental high-quality batch would spend it silently.
 */
export const OPENAI_IMAGE_MODEL = "gpt-image-1";
const ENDPOINT = "https://api.openai.com/v1/images/generations";

export function createOpenAIImageProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly modelCode?: string | undefined;
}): ImageProvider {
  const call = options.fetch ?? fetch;
  return {
    code: "openai",
    modelCode: options.modelCode ?? OPENAI_IMAGE_MODEL,
    providerId: "a1000000-0000-4000-8000-000000000003",
    modelId: "a2000000-0000-4000-8000-000000000020",
    // Medium quality, 1536x1024: about four US cents an image.
    costPerImageUsd: 0.04,
    generate: async (request, context): Promise<GeneratedImage> => {
      let response: Response;
      try {
        response = await call(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.modelCode,
            prompt: request.prompt,
            n: 1,
            size: request.shape === "SQUARE" ? "1024x1024" : "1536x1024",
            quality: "medium",
            output_format: "png",
          }),
          signal: context.signal,
        });
      } catch (error) {
        throw new ModelProviderFailure("openai image request failed", {
          failureClass: "TRANSIENT",
          providerCode: "openai",
          cause: error,
        });
      }
      if (!response.ok) {
        throw new ModelProviderFailure("openai image request refused", {
          failureClass:
            response.status === 429
              ? "RATE_LIMIT"
              : response.status === 401 || response.status === 403
                ? "AUTHENTICATION"
                : response.status === 400
                  ? "INVALID_REQUEST"
                  : "PROVIDER_OUTAGE",
          providerCode: "openai",
          providerStatus: response.status,
        });
      }
      const body: unknown = await response.json().catch(() => null);
      const data: unknown = Reflect.get(Object(body), "data");
      const first: unknown = Array.isArray(data) ? data[0] : undefined;
      const encoded: unknown = Reflect.get(Object(first), "b64_json");
      if (typeof encoded !== "string" || encoded.length === 0) {
        throw new ModelProviderFailure("openai image response had no image", {
          failureClass: "INVALID_MODEL_OUTPUT",
          providerCode: "openai",
        });
      }
      return {
        bytes: new Uint8Array(Buffer.from(encoded, "base64")),
        contentType: "image/png",
      };
    },
  };
}
