import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import {
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
} from "../src/index.js";
import { createGoogleModelProvider } from "../src/providers/google.js";
import { createQTurnReader } from "../src/q/index.js";

/**
 * LIVE eval (not run without approval): TURN_READER v53 reads a request to
 * present Capital Q itself as NAVIGATE Q_PITCH, by meaning and in several
 * languages, and never a question about pitches, pitch decks or one
 * feature. Run only by `pnpm test:live-model` with CQ_LIVE_MODEL_TESTS=1
 * and a Gemini key; synthetic sentences only (about 20 short reads).
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const GEMINI = process.env["GEMINI_API_KEY"];
const NOW = "2026-09-26T00:00:00.000Z";

const catalog: ModelCatalogSnapshot = {
  providers: [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      code: "google",
      name: "Google Gemini Developer API",
      status: "ACTIVE",
      privacyPolicyClass: "UNREVIEWED",
      supportsZeroRetention: false,
      regionSupport: ["global"],
    },
  ],
  models: [
    {
      id: "a2000000-0000-4000-8000-000000000001",
      providerId: "a1000000-0000-4000-8000-000000000001",
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
  ],
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      modelId: "a2000000-0000-4000-8000-000000000001",
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 0.3,
      cachedInputPerMillion: 0.03,
      outputPerMillion: 2.5,
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
      preferredModels: ["a2000000-0000-4000-8000-000000000001"],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    },
  ],
  loadedAt: NOW,
};

const PITCH_REQUESTS = [
  "pitch Capital Q",
  "explain Capital Q to us",
  "what can you do?",
  "show me what this is",
  "give us the tour of this platform",
  "Can you walk my partners through what Capital Q does?",
  "présente-nous Capital Q",
  "¿qué puedes hacer?",
  "Zeig uns, was Capital Q kann",
  "apresenta o Capital Q para nós",
  "Tuonyeshe Capital Q inafanya nini",
];
const NOT_PITCH = [
  "what is a pitch deck?",
  "open my pitch",
  "how do I improve my pitch?",
  "what can you do with my deck?",
  "show me Harbourline's pitch",
  "make me a pitch deck for my company",
  "take me to Discover",
];

describe.skipIf(!LIVE || GEMINI === undefined)(
  "live: Q Pitch is read by meaning",
  () => {
    it(
      "starts the tour for a request to present Capital Q, and only then",
      async () => {
        const reader = createQTurnReader({
          gateway: createModelGateway({
            catalog: createStaticModelCatalog(catalog),
            registry: createModelProviderRegistry([
              createGoogleModelProvider({ apiKey: GEMINI ?? "" }),
            ]),
            usage: createInMemoryModelUsageRepository(),
          }),
          logger: createLogger(
            { serviceName: "live-eval", environment: "test" },
            { level: "silent" },
          ),
          sensitivity: "PUBLIC",
        });
        const read = (utterance: string) =>
          reader.read({
            utterance,
            recentTurns: [],
            modality: "TEXT",
            actions: [],
            attribution: {
              tenantId: "c0000000-0000-4000-8000-000000000001",
              userId: "b0000000-0000-4000-8000-000000000001",
              correlationId: "cor_live_eval",
            },
          });
        const misses: string[] = [];
        for (const utterance of PITCH_REQUESTS) {
          const r = await read(utterance);
          if (
            r?.tool?.kind !== "NAVIGATE" ||
            r.tool.destination !== "Q_PITCH"
          ) {
            misses.push(`not read as Q_PITCH: "${utterance}"`);
          }
        }
        for (const utterance of NOT_PITCH) {
          const r = await read(utterance);
          if (
            r?.tool?.kind === "NAVIGATE" &&
            r.tool.destination === "Q_PITCH"
          ) {
            misses.push(`read as Q_PITCH: "${utterance}"`);
          }
        }
        expect(misses).toEqual([]);
      },
      5 * 60_000,
    );
  },
);
