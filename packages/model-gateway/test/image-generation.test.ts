import { describe, expect, it } from "vitest";

import {
  createImageGateway,
  createFakeImageProvider,
  finalImagePrompt,
  IMAGE_PROMPT_EXCLUSIONS,
} from "../src/images/index.js";
import { createGoogleImageProvider } from "../src/images/google.js";
import { createOpenAIImageProvider } from "../src/images/openai.js";
import { createInMemoryModelUsageRepository } from "../src/index.js";

/**
 * DOCS: image generation through the gateway. Fake providers only: no
 * test spends a provider credit. Keys are disabled values.
 */

const KEY = "disabled-locally-000000000000";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  qRunId: "22222222-0000-4000-8000-000000000001",
};

describe("the image gateway", () => {
  it("returns the first good image and records every attempt as IMAGE_GENERATION", async () => {
    const usage = createInMemoryModelUsageRepository();
    const seen: string[] = [];
    const gateway = createImageGateway({
      enabled: true,
      usage,
      providers: [
        createFakeImageProvider(
          () =>
            Promise.resolve({
              bytes: new TextEncoder().encode("<svg/>"),
              contentType: "image/png",
            }),
          { code: "first" },
        ),
        createFakeImageProvider(
          (request) => {
            seen.push(request.prompt);
            return Promise.resolve({ bytes: PNG, contentType: "image/png" });
          },
          { code: "second", costPerImageUsd: 0.04 },
        ),
      ],
    });
    const result = await gateway.generate({
      prompt: "Freight trucks at dawn, in deep green.",
      shape: "LANDSCAPE",
      attribution: ATTRIBUTION,
    });
    expect(result).toMatchObject({
      status: "GENERATED",
      providerCode: "second",
      costUsd: 0.04,
    });
    // The exclusions are always sent, whoever built the prompt.
    expect(seen[0]?.endsWith(IMAGE_PROMPT_EXCLUSIONS)).toBe(true);
    const rows = usage.entries;
    expect(
      rows.map((row) => [row.taskClass, row.success, row.errorCode]),
    ).toEqual([
      ["IMAGE_GENERATION", false, "INVALID_MODEL_OUTPUT"],
      ["IMAGE_GENERATION", true, undefined],
    ]);
  });

  it("is unavailable when switched off or with no provider, and calls nobody", async () => {
    let called = false;
    const off = createImageGateway({
      enabled: false,
      providers: [
        createFakeImageProvider(() => {
          called = true;
          return Promise.resolve({ bytes: PNG, contentType: "image/png" });
        }),
      ],
    });
    expect(off.enabled).toBe(false);
    expect(
      await off.generate({
        prompt: "x",
        shape: "SQUARE",
        attribution: ATTRIBUTION,
      }),
    ).toEqual({ status: "UNAVAILABLE" });
    expect(called).toBe(false);
    expect(createImageGateway({ enabled: true, providers: [] }).enabled).toBe(
      false,
    );
  });

  it("bounds the prompt and keeps the exclusions at its end", () => {
    const prompt = finalImagePrompt("a ".repeat(2_000));
    expect(prompt.length).toBeLessThanOrEqual(1_200);
    expect(prompt.endsWith(IMAGE_PROMPT_EXCLUSIONS)).toBe(true);
  });
});

describe("the adapters", () => {
  it("OpenAI: one medium image, key in the header, PNG decoded", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = createOpenAIImageProvider({
      apiKey: KEY,
      fetch: (url, init) => {
        calls.push({
          url: url instanceof Request ? url.url : url.toString(),
          init: init ?? {},
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ b64_json: Buffer.from(PNG).toString("base64") }],
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      },
    });
    const image = await provider.generate(
      { modelCode: provider.modelCode, prompt: "p", shape: "LANDSCAPE" },
      { signal: new AbortController().signal },
    );
    expect(image.bytes).toEqual(PNG);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    const raw = calls[0]?.init.body;
    const body: unknown = JSON.parse(typeof raw === "string" ? raw : "{}");
    expect(body).toMatchObject({
      model: "gpt-image-1",
      n: 1,
      quality: "medium",
      size: "1536x1024",
    });
  });

  it("Gemini: key in a header, never the URL; inline image decoded", async () => {
    const calls: string[] = [];
    const provider = createGoogleImageProvider({
      apiKey: KEY,
      fetch: (url, init) => {
        calls.push(url instanceof Request ? url.url : url.toString());
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(KEY);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: Buffer.from(PNG).toString("base64"),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          ),
        );
      },
    });
    const image = await provider.generate(
      { modelCode: provider.modelCode, prompt: "p", shape: "SQUARE" },
      { signal: new AbortController().signal },
    );
    expect(image.contentType).toBe("image/png");
    expect(calls[0]).not.toContain(KEY);
  });

  it("maps a refusal to a failure class the gateway records", async () => {
    const provider = createOpenAIImageProvider({
      apiKey: KEY,
      fetch: () => Promise.resolve(new Response("{}", { status: 429 })),
    });
    await expect(
      provider.generate(
        { modelCode: provider.modelCode, prompt: "p", shape: "SQUARE" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ failureClass: "RATE_LIMIT" });
  });
});
