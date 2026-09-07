import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
  type ModelProvider,
} from "../src/index.js";
import { createGoogleModelProvider } from "../src/providers/google.js";
import { createGroqModelProvider } from "../src/providers/groq.js";

/**
 * LIVE provider smoke tests (packet §52, §85). Real network, real
 * providers, SYNTHETIC public input only, through exactly the same
 * ModelGateway every other test uses. Run only by `pnpm test:live-model`,
 * which sets CQ_LIVE_MODEL_TESTS=1 and supplies the two key names; a
 * provider whose key is absent is skipped, never faked.
 *
 * Nothing here prints a key. The values are read once from the process
 * environment inside this file and handed to the adapters.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const GEMINI = process.env["GEMINI_API_KEY"];
const GROQ = process.env["GROQ_API_KEY"];

/** The seeded catalog, mirrored so the live suite needs no database. */
const IDS = {
  google: "a1000000-0000-4000-8000-000000000001",
  groq: "a1000000-0000-4000-8000-000000000002",
  flashLite: "a2000000-0000-4000-8000-000000000001",
  flash: "a2000000-0000-4000-8000-000000000002",
  oss20: "a2000000-0000-4000-8000-000000000003",
  oss120: "a2000000-0000-4000-8000-000000000004",
};
const NOW = "2026-09-05T00:00:00.000Z";

const catalog: ModelCatalogSnapshot = {
  providers: [
    {
      id: IDS.google,
      code: "google",
      name: "Google Gemini Developer API",
      status: "ACTIVE",
      privacyPolicyClass: "UNREVIEWED",
      supportsZeroRetention: false,
      regionSupport: ["global"],
    },
    {
      id: IDS.groq,
      code: "groq",
      name: "GroqCloud",
      status: "ACTIVE",
      privacyPolicyClass: "UNREVIEWED",
      supportsZeroRetention: false,
      regionSupport: ["global"],
    },
  ],
  models: [
    {
      id: IDS.flashLite,
      providerId: IDS.google,
      modelCode: "gemini-3.5-flash-lite",
      modelFamily: "gemini-3.5",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsAudio: true,
      supportsRealtime: false,
      supportsPromptCache: true,
      supportsReasoning: true,
      sensitivityCeiling: "PUBLIC",
      qualityClass: "STANDARD",
      latencyClass: "FAST",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    {
      id: IDS.flash,
      providerId: IDS.google,
      modelCode: "gemini-3.8-flash",
      modelFamily: "gemini-3.8",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsAudio: true,
      supportsRealtime: false,
      supportsPromptCache: true,
      supportsReasoning: true,
      sensitivityCeiling: "PUBLIC",
      qualityClass: "HIGH",
      latencyClass: "STANDARD",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    {
      id: IDS.oss20,
      providerId: IDS.groq,
      modelCode: "openai/gpt-oss-20b",
      modelFamily: "gpt-oss",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      supportsAudio: false,
      supportsRealtime: false,
      supportsPromptCache: false,
      supportsReasoning: true,
      sensitivityCeiling: "INTERNAL",
      qualityClass: "STANDARD",
      latencyClass: "FAST",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    {
      id: IDS.oss120,
      providerId: IDS.groq,
      modelCode: "openai/gpt-oss-120b",
      modelFamily: "gpt-oss",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      supportsAudio: false,
      supportsRealtime: false,
      supportsPromptCache: false,
      supportsReasoning: true,
      sensitivityCeiling: "INTERNAL",
      qualityClass: "HIGH",
      latencyClass: "FAST",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      modelId: IDS.flashLite,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 0.3,
      cachedInputPerMillion: 0.03,
      outputPerMillion: 2.5,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    {
      id: "a3000000-0000-4000-8000-000000000002",
      modelId: IDS.flash,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 0.75,
      cachedInputPerMillion: 0.075,
      outputPerMillion: 3.75,
      effectiveFrom: NOW,
      effectiveTo: "2027-01-01T00:00:00.000Z",
    },
    {
      id: "a3000000-0000-4000-8000-000000000004",
      modelId: IDS.oss20,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 0.075,
      cachedInputPerMillion: null,
      outputPerMillion: 0.3,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    {
      id: "a3000000-0000-4000-8000-000000000005",
      modelId: IDS.oss120,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 0.15,
      cachedInputPerMillion: null,
      outputPerMillion: 0.6,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  routingPolicies: [
    {
      id: "a4000000-0000-4000-8000-000000000001",
      code: "fast_classification.v1",
      taskClass: "FAST_CLASSIFICATION",
      sensitivityClass: "RESTRICTED",
      qualityFloor: "BASIC",
      latencyTargetMs: 5_000,
      costCeilingUsd: 0.02,
      preferredModels: [IDS.flashLite],
      fallbackModels: [IDS.oss20],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    },
    {
      id: "a4000000-0000-4000-8000-000000000004",
      code: "normal_dialogue.v1",
      taskClass: "NORMAL_DIALOGUE",
      sensitivityClass: "RESTRICTED",
      qualityFloor: "STANDARD",
      latencyTargetMs: 20_000,
      costCeilingUsd: 0.1,
      preferredModels: [IDS.oss120],
      fallbackModels: [IDS.flash],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    },
  ],
  loadedAt: NOW,
};

const Category = z
  .object({
    category: z.enum([
      "investment_software",
      "consumer_app",
      "hardware",
      "other",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

const SYNTHETIC_SENTENCE =
  "Synthetic test fixture: a fictional company builds portfolio-monitoring software for private-market investors.";

function build(providers: ModelProvider[]) {
  const usage = createInMemoryModelUsageRepository();
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry(providers),
    usage,
  });
  return { gateway, usage };
}

function report(
  label: string,
  result: {
    modelCode: string;
    latencyMs: number;
    usage: { inputTokens: number; outputTokens: number };
    cost: { amount: number; basis: string };
  },
) {
  // Operational metadata only; never the prompt or the answer text.
  console.log(
    `[live] ${label}: model=${result.modelCode} latency_ms=${result.latencyMs} tokens_in=${result.usage.inputTokens} tokens_out=${result.usage.outputTokens} cost_usd=${result.cost.amount} basis=${result.cost.basis}`,
  );
}

describe.skipIf(!LIVE)("live model smoke through the Model Gateway", () => {
  it.skipIf(GEMINI === undefined)(
    "Gemini: structured synthetic classification (PUBLIC)",
    async () => {
      const { gateway, usage } = build([
        createGoogleModelProvider({ apiKey: GEMINI ?? "" }),
      ]);
      const result = await gateway.execute(
        {
          taskClass: "FAST_CLASSIFICATION",
          sensitivity: "PUBLIC",
          messages: [
            {
              role: "SYSTEM",
              content:
                "Classify the sentence. Reply with JSON only, matching the schema.",
            },
            { role: "USER", content: SYNTHETIC_SENTENCE },
          ],
          output: {
            kind: "STRUCTURED",
            schemaName: "Category",
            jsonSchema: z.toJSONSchema(Category),
          },
          budget: {
            maxAttempts: 2,
            maxEstimatedCostUsd: 0.01,
            maxOutputTokens: 256,
            attemptTimeoutMs: 30_000,
          },
          attribution: {
            tenantId: "00000000-0000-4000-8000-00000000c0de",
            correlationId: "cor_live_gemini",
          },
        },
        { schema: Category },
      );
      expect(result.providerCode).toBe("google");
      expect(result.modelCode).toContain("gemini-3.5-flash-lite");
      expect(result.output.kind).toBe("STRUCTURED");
      if (result.output.kind === "STRUCTURED") {
        expect(result.output.value.category).toBe("investment_software");
      }
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.cost.basis).toBe("PRICE_SNAPSHOT");
      expect(usage.entries).toHaveLength(result.attempts.length);
      report("gemini", result);
    },
  );

  it.skipIf(GROQ === undefined)(
    "Groq: text dialogue (PUBLIC) and structured classification via tenant policy",
    async () => {
      const { gateway, usage } = build([
        createGroqModelProvider({ apiKey: GROQ ?? "" }),
      ]);
      const text = await gateway.execute({
        taskClass: "NORMAL_DIALOGUE",
        sensitivity: "PUBLIC",
        messages: [
          {
            role: "SYSTEM",
            content: "You are a test assistant. Reply in one short sentence.",
          },
          {
            role: "USER",
            content: `Say hello and name the product category in: ${SYNTHETIC_SENTENCE}`,
          },
        ],
        output: { kind: "TEXT" },
        budget: {
          maxAttempts: 2,
          maxEstimatedCostUsd: 0.01,
          maxOutputTokens: 200,
          attemptTimeoutMs: 30_000,
        },
        attribution: {
          tenantId: "00000000-0000-4000-8000-00000000c0de",
          correlationId: "cor_live_groq",
        },
      });
      expect(text.providerCode).toBe("groq");
      expect(text.modelCode).toBe("openai/gpt-oss-120b");
      expect(text.output.kind).toBe("TEXT");
      expect(text.usage.outputTokens).toBeGreaterThan(0);
      report("groq text", text);

      // The same light task the Gemini test used, with google denied by tenant
      // policy: the gateway routes to the Groq fallback, structured.
      const structured = await gateway.execute(
        {
          taskClass: "FAST_CLASSIFICATION",
          sensitivity: "PUBLIC",
          messages: [
            {
              role: "SYSTEM",
              content:
                "Classify the sentence. Reply with JSON only, matching the schema.",
            },
            { role: "USER", content: SYNTHETIC_SENTENCE },
          ],
          output: {
            kind: "STRUCTURED",
            schemaName: "Category",
            jsonSchema: z.toJSONSchema(Category),
          },
          budget: {
            maxAttempts: 2,
            maxEstimatedCostUsd: 0.01,
            maxOutputTokens: 256,
            attemptTimeoutMs: 30_000,
          },
          attribution: {
            tenantId: "00000000-0000-4000-8000-00000000c0de",
            correlationId: "cor_live_groq_json",
          },
          tenantPolicy: { deniedProviderCodes: ["google"] },
        },
        { schema: Category },
      );
      expect(structured.modelCode).toBe("openai/gpt-oss-20b");
      expect(structured.output.kind).toBe("STRUCTURED");
      if (structured.output.kind === "STRUCTURED") {
        expect(structured.output.value.category).toBe("investment_software");
      }
      report("groq structured", structured);
      expect(
        usage.entries.every(
          (e) => e.tenantId === "00000000-0000-4000-8000-00000000c0de",
        ),
      ).toBe(true);
    },
  );

  it.skipIf(GEMINI === undefined)(
    "Gemini is excluded before any call for a CONFIDENTIAL request",
    async () => {
      let calls = 0;
      const real = createGoogleModelProvider({ apiKey: GEMINI ?? "" });
      const counting: ModelProvider = {
        ...real,
        generate: (request, context) => {
          calls += 1;
          return real.generate(request, context);
        },
      };
      const { gateway } = build([counting]);
      await expect(
        gateway.execute({
          taskClass: "FAST_CLASSIFICATION",
          sensitivity: "CONFIDENTIAL",
          messages: [
            { role: "USER", content: "This text must never be sent." },
          ],
          output: { kind: "TEXT" },
          budget: {
            maxAttempts: 2,
            maxEstimatedCostUsd: 0.01,
            maxOutputTokens: 64,
            attemptTimeoutMs: 30_000,
          },
          attribution: {
            tenantId: "00000000-0000-4000-8000-00000000c0de",
            correlationId: "cor_live_denied",
          },
        }),
      ).rejects.toMatchObject({ failureClass: "POLICY_INELIGIBLE" });
      expect(calls).toBe(0);
    },
  );
});
