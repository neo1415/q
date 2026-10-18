import { describe, expect, it } from "vitest";

import { ModelProviderFailure } from "../src/errors.js";
import {
  createFakeImageProvider,
  createImageGateway,
  GENERATED_IMAGES_PER_DOCUMENT_MAX,
  IMAGE_MODEL_CONFIG,
  isBillingRefusal,
} from "../src/images/index.js";
import {
  createGoogleImageProvider,
  GOOGLE_IMAGE_MODEL,
} from "../src/images/google.js";
import { createPexelsStockPhotoProvider } from "../src/images/stock.js";
import { createInMemoryModelUsageRepository } from "../src/index.js";

/**
 * Q room W5 (R8): the image model is config, a billing refusal stops
 * asking (no retry loop), and stock photos come from Pexels with their
 * credit. Fake fetches only: no test reaches a provider.
 */

const KEY = "disabled-locally-000000000000";
const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
};

describe("image model config", () => {
  it("runs Nano Banana 2 Lite at $0.034, not the retired 2.5 model", () => {
    expect(GOOGLE_IMAGE_MODEL).toBe("gemini-3.1-flash-lite-image");
    expect(IMAGE_MODEL_CONFIG.google.costPerImageUsd).toBe(0.034);
    const provider = createGoogleImageProvider({ apiKey: KEY });
    expect(provider.modelCode).toBe("gemini-3.1-flash-lite-image");
    expect(provider.costPerImageUsd).toBe(0.034);
    expect(provider.modelId).toBe(IMAGE_MODEL_CONFIG.google.modelId);
    expect(GENERATED_IMAGES_PER_DOCUMENT_MAX).toBe(6);
  });

  it("calls the configured model in the URL", async () => {
    const urls: string[] = [];
    const provider = createGoogleImageProvider({
      apiKey: KEY,
      fetch: (url) => {
        urls.push(url instanceof Request ? url.url : url.toString());
        return Promise.resolve(new Response("{}", { status: 500 }));
      },
    });
    await expect(
      provider.generate(
        { modelCode: provider.modelCode, prompt: "p", shape: "LANDSCAPE" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(ModelProviderFailure);
    expect(urls[0]).toContain("gemini-3.1-flash-lite-image:generateContent");
  });
});

describe("billing refusals", () => {
  it("classes no-billing and spent quota as BUDGET_EXCEEDED", async () => {
    expect(isBillingRefusal(402, "")).toBe(true);
    expect(
      isBillingRefusal(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'),
    ).toBe(true);
    expect(
      isBillingRefusal(400, "Image generation requires billing enabled"),
    ).toBe(true);
    expect(isBillingRefusal(429, "slow down")).toBe(false);
    expect(isBillingRefusal(500, "quota")).toBe(false);
    const provider = createGoogleImageProvider({
      apiKey: KEY,
      fetch: () =>
        Promise.resolve(
          new Response(
            '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}',
            { status: 429 },
          ),
        ),
    });
    await expect(
      provider.generate(
        { modelCode: provider.modelCode, prompt: "p", shape: "LANDSCAPE" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ failureClass: "BUDGET_EXCEEDED" });
  });

  it("pauses a provider after a billing refusal: the next asks cost no call", async () => {
    let calls = 0;
    let clock = 1_000;
    const usage = createInMemoryModelUsageRepository();
    const gateway = createImageGateway({
      enabled: true,
      usage,
      now: () => clock,
      billingCooldownMs: 60_000,
      providers: [
        createFakeImageProvider(() => {
          calls += 1;
          return Promise.reject(
            new ModelProviderFailure("no billing", {
              failureClass: "BUDGET_EXCEEDED",
              providerCode: "google",
            }),
          );
        }),
      ],
    });
    const ask = () =>
      gateway.generate({
        prompt: "abstract freight network",
        shape: "LANDSCAPE",
        attribution: ATTRIBUTION,
      });
    expect(await ask()).toEqual({ status: "FAILED", reason: "BILLING" });
    // Five more pictures for the same deck: not one more provider call.
    for (let index = 0; index < 5; index += 1) {
      expect(await ask()).toEqual({ status: "UNAVAILABLE", reason: "BILLING" });
    }
    expect(calls).toBe(1);
    // A refused picture is never billed.
    expect(usage.entries.map((row) => row.costUsd)).toEqual([0]);
    // After the cooldown it may try once more.
    clock += 61_000;
    await ask();
    expect(calls).toBe(2);
  });

  it("an ordinary failure does not pause the provider", async () => {
    let calls = 0;
    const gateway = createImageGateway({
      enabled: true,
      providers: [
        createFakeImageProvider(() => {
          calls += 1;
          return Promise.reject(
            new ModelProviderFailure("outage", {
              failureClass: "PROVIDER_OUTAGE",
              providerCode: "google",
            }),
          );
        }),
      ],
    });
    const ask = () =>
      gateway.generate({
        prompt: "x",
        shape: "LANDSCAPE",
        attribution: ATTRIBUTION,
      });
    expect(await ask()).toEqual({ status: "FAILED" });
    expect(await ask()).toEqual({ status: "FAILED" });
    expect(calls).toBe(2);
  });
});

describe("Pexels stock photos", () => {
  it("is absent with a disabled key, so nothing is ever called", () => {
    expect(createPexelsStockPhotoProvider(KEY)).toBeUndefined();
    expect(createPexelsStockPhotoProvider(undefined)).toBeUndefined();
  });

  it("returns photos with the photographer's credit and sends only the search words", async () => {
    const seen: string[] = [];
    const provider = createPexelsStockPhotoProvider(
      "pexels-test-key-0000000000000",
      (url, init) => {
        seen.push(url instanceof Request ? url.url : url.toString());
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "pexels-test-key-0000000000000",
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              photos: [
                {
                  alt: "Trucks at a depot",
                  photographer: "Ada Obi",
                  src: { large: "https://images.pexels.com/photos/1/a.jpeg" },
                },
                // Not the stock host: dropped.
                {
                  alt: "x",
                  photographer: "y",
                  src: { large: "https://example.com/a.jpeg" },
                },
              ],
            }),
          ),
        );
      },
    );
    const photos = (await provider?.search("freight logistics", {})) ?? [];
    expect(photos).toEqual([
      {
        url: "https://images.pexels.com/photos/1/a.jpeg",
        alt: "Trucks at a depot",
        credit: "Photo by Ada Obi on Pexels",
      },
    ]);
    expect(new URL(seen[0] ?? "").searchParams.get("query")).toBe(
      "freight logistics",
    );
  });

  it("a failed search is no photos, not an error", async () => {
    const provider = createPexelsStockPhotoProvider(
      "pexels-test-key-0000000000000",
      () => Promise.reject(new Error("offline")),
    );
    expect(await provider?.search("x", {})).toEqual([]);
  });
});
