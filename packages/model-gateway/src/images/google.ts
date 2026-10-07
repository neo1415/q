import { ModelProviderFailure } from "../errors.js";
import { IMAGE_MODEL_CONFIG } from "./config.js";
import {
  isBillingRefusal,
  type GeneratedImage,
  type ImageProvider,
} from "./index.js";

/**
 * Gemini's image model behind the image adapter (DOCS): the fallback when
 * OpenAI is not configured or fails. The key travels in a header, never
 * in the URL, so it cannot land in an access log. The model is config
 * (images/config.ts), not a constant here.
 */
export const GOOGLE_IMAGE_MODEL = IMAGE_MODEL_CONFIG.google.modelCode;

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function createGoogleImageProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly modelCode?: string | undefined;
}): ImageProvider {
  const call = options.fetch ?? fetch;
  const modelCode = options.modelCode ?? GOOGLE_IMAGE_MODEL;
  return {
    code: "google",
    modelCode,
    providerId: IMAGE_MODEL_CONFIG.google.providerId,
    modelId: IMAGE_MODEL_CONFIG.google.modelId,
    costPerImageUsd: IMAGE_MODEL_CONFIG.google.costPerImageUsd,
    generate: async (request, context): Promise<GeneratedImage> => {
      let response: Response;
      try {
        response = await call(
          `${BASE}/${encodeURIComponent(request.modelCode)}:generateContent`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": options.apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: request.prompt }] }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                  aspectRatio: request.shape === "SQUARE" ? "1:1" : "3:2",
                },
              },
            }),
            signal: context.signal,
          },
        );
      } catch (error) {
        throw new ModelProviderFailure("google image request failed", {
          failureClass: "TRANSIENT",
          providerCode: "google",
          cause: error,
        });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ModelProviderFailure("google image request refused", {
          failureClass: isBillingRefusal(response.status, detail)
            ? "BUDGET_EXCEEDED"
            : response.status === 429
              ? "RATE_LIMIT"
              : response.status === 401 || response.status === 403
                ? "AUTHENTICATION"
                : response.status === 400
                  ? "INVALID_REQUEST"
                  : "PROVIDER_OUTAGE",
          providerCode: "google",
          providerStatus: response.status,
        });
      }
      const body: unknown = await response.json().catch(() => null);
      const candidates: unknown = Reflect.get(Object(body), "candidates");
      const parts: unknown = Array.isArray(candidates)
        ? Reflect.get(
            Object(Reflect.get(Object(candidates[0]), "content")),
            "parts",
          )
        : undefined;
      if (Array.isArray(parts)) {
        for (const part of parts as unknown[]) {
          const inline: unknown =
            Reflect.get(Object(part), "inlineData") ??
            Reflect.get(Object(part), "inline_data");
          const data: unknown = Reflect.get(Object(inline), "data");
          const mime: unknown =
            Reflect.get(Object(inline), "mimeType") ??
            Reflect.get(Object(inline), "mime_type");
          if (
            typeof data === "string" &&
            (mime === "image/png" || mime === "image/jpeg")
          ) {
            return {
              bytes: new Uint8Array(Buffer.from(data, "base64")),
              contentType: mime,
            };
          }
        }
      }
      throw new ModelProviderFailure("google image response had no image", {
        failureClass: "INVALID_MODEL_OUTPUT",
        providerCode: "google",
      });
    },
  };
}
