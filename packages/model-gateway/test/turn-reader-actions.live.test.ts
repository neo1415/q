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
 * LIVE eval (not run without approval): a request for one of the run's own
 * actions is never read as a document, across unseen paraphrases, and a
 * genuine document request still is. Run only by `pnpm test:live-model`
 * with CQ_LIVE_MODEL_TESTS=1 and a Gemini key; synthetic sentences only.
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

const ACTIONS = [
  {
    name: "propose_handle_claim",
    does: "Proposes a Capital Q handle and shareable Q card (with its QR code) for the person's own company or investor organisation, for their approval.",
  },
  {
    name: "propose_profile_change",
    does: "Changes their own profile — their name and headline, their company's profile, or their investor organisation's profile — shown to them exactly and applied only when they approve.",
  },
];

const ACTION_REQUESTS = [
  "Make a Q card for Zino Aviation with the handle zino-aviation",
  "set up our public card",
  "claim @kivu for us",
  "I want a shareable card with a QR",
  "edit my profile",
  "change my headline to fintech founder in Lagos",
  "our website is zino.aero now, put that on the company page",
  "can you fix my company description, it's out of date",
];
const SCREEN_REQUESTS = ["take me to my profile", "open my profile page"];
const DOCUMENT_REQUESTS = [
  "write a brief on Zino Aviation",
  "make me a pitch deck for my company",
];

describe.skipIf(!LIVE || GEMINI === undefined)(
  "live: an action request is never a document",
  () => {
    it(
      "reads each case as expected",
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
        const misses: string[] = [];
        const read = (utterance: string) =>
          reader.read({
            utterance,
            recentTurns: [],
            modality: "TEXT",
            actions: ACTIONS,
            attribution: {
              tenantId: "c0000000-0000-4000-8000-000000000001",
              userId: "b0000000-0000-4000-8000-000000000001",
              correlationId: "cor_live_eval",
            },
          });
        for (const utterance of ACTION_REQUESTS) {
          const r = await read(utterance);
          if (r === null || r.tool?.kind === "PREPARE_DOCUMENT") {
            misses.push(`action read as a document: "${utterance}"`);
          }
        }
        for (const utterance of ACTION_REQUESTS) {
          const r = await read(utterance);
          if (r?.tool?.kind === "NAVIGATE") {
            misses.push(`action read as navigation: "${utterance}"`);
          }
        }
        for (const utterance of SCREEN_REQUESTS) {
          const r = await read(utterance);
          if (r?.tool?.kind !== "NAVIGATE") {
            misses.push(
              `screen request not read as navigation: "${utterance}"`,
            );
          }
        }
        for (const utterance of DOCUMENT_REQUESTS) {
          const r = await read(utterance);
          if (r?.tool?.kind !== "PREPARE_DOCUMENT") {
            misses.push(`document not read as one: "${utterance}"`);
          }
        }
        expect(misses).toEqual([]);
      },
      5 * 60_000,
    );
  },
);
