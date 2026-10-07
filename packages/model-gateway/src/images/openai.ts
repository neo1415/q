import { ModelProviderFailure } from "../errors.js";
import { IMAGE_MODEL_CONFIG } from "./config.js";
import {
  isBillingRefusal,
  type GeneratedImage,
  type ImageProvider,
} from "./index.js";

/**
 * OpenAI's image endpoint behind the image adapter (DOCS). One model,
 * medium quality, one image per call: the account is the founder's and an
 * accidental high-quality batch would spend it silently.
 */
export const OPENAI_IMAGE_MODEL = IMAGE_MODEL_CONFIG.openai.modelCode;
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
    providerId: IMAGE_MODEL_CONFIG.openai.providerId,
    modelId: IMAGE_MODEL_CONFIG.openai.modelId,
    costPerImageUsd: IMAGE_MODEL_CONFIG.openai.costPerImageUsd,
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
        const detail = await response.text().catch(() => "");
        throw new ModelProviderFailure("openai image request refused", {
          failureClass: isBillingRefusal(response.status, detail)
            ? "BUDGET_EXCEEDED"
            : response.status === 429
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
