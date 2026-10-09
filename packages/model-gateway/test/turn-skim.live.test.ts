import { describe, expect, it } from "vitest";

import {
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
} from "../src/index.js";
import { createGoogleModelProvider } from "../src/providers/google.js";
import { createTurnSkimmer } from "../src/q/index.js";

/**
 * LIVE check of the fast lane's first read (founder-approved, 2026-10-09):
 * ten short synthetic asks -- discovery, fit, mandate and non-discovery
 * controls -- one TURN_SKIM call each through the Q Model Gateway, on the
 * production fast-classification model and price. Run only by
 * `pnpm test:live-model` with CQ_LIVE_MODEL_TESTS=1 and a Gemini key; it
 * prints calls, tokens, latency p50/p95 and cost, never the key.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const GEMINI = process.env["GEMINI_API_KEY"];
const NOW = "2026-10-09T00:00:00.000Z";

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
  // The hosted price (ai_ops.model_prices, 2026-10-09).
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

/** [what was said, the kind expected, whether the fast lane may take it]. */
const ASKS: readonly [string, "DISCOVER_COMPANIES" | "FIT" | "OTHER"][] = [
  ["Show me three fintech companies", "DISCOVER_COMPANIES"],
  ["Give me three companies in the fintech space", "DISCOVER_COMPANIES"],
  ["top three fintech", "DISCOVER_COMPANIES"],
  ["Find five healthtech startups", "DISCOVER_COMPANIES"],
  ["three fintech companies in Nigeria", "DISCOVER_COMPANIES"],
  ["Which fintech companies suit my mandate", "DISCOVER_COMPANIES"],
  ["give me three good examples of companies I can invest in", "FIT"],
  ["what is my mandate?", "OTHER"],
  ["what should I ask Kora's founder on our call?", "OTHER"],
  ["compare those three", "OTHER"],
];

const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

describe.skipIf(!LIVE || GEMINI === undefined)(
  "live: the first read names companies of a kind, and only that",
  () => {
    it("reads each ask, once, and reports what it cost", async () => {
      const usage = createInMemoryModelUsageRepository();
      const skimmer = createTurnSkimmer({
        gateway: createModelGateway({
          catalog: createStaticModelCatalog(catalog),
          registry: createModelProviderRegistry([
            createGoogleModelProvider({ apiKey: GEMINI ?? "" }),
          ]),
          usage,
        }),
        sensitivity: "PUBLIC",
      });
      const rows: string[] = [];
      const latencies: number[] = [];
      let wrongFastLane = 0;
      for (const [said, expected] of ASKS) {
        const started = Date.now();
        const read = await skimmer.skim({
          utterance: said,
          recentTurns: [],
          attribution: {
            tenantId: "c0000000-0000-4000-8000-000000000001",
            correlationId: "cor_live_skim",
          },
        });
        latencies.push(Date.now() - started);
        const fast =
          read !== null && read.confidence === "HIGH" && read.kind !== "OTHER";
        if (fast && read.kind !== expected) wrongFastLane += 1;
        rows.push(
          `${said} -> ${read?.kind ?? "null"}/${read?.confidence ?? "-"} ${JSON.stringify(read?.discover ?? null)} (expected ${expected})`,
        );
      }
      const records = usage.entries;
      const tokens = records.reduce(
        (sum, r) => ({
          input: sum.input + r.inputTokens,
          cached: sum.cached + r.cachedInputTokens,
          output: sum.output + r.outputTokens,
          cost: sum.cost + (r.costUsd ?? 0),
        }),
        { input: 0, cached: 0, output: 0, cost: 0 },
      );
      console.log(
        [
          ...rows,
          `calls ${String(records.length)}; tokens in ${String(tokens.input)} (cached ${String(tokens.cached)}) out ${String(tokens.output)}; cost $${tokens.cost.toFixed(6)}`,
          `latency p50 ${String(percentile(latencies, 0.5))} ms, p95 ${String(percentile(latencies, 0.95))} ms`,
        ].join("\n"),
      );
      expect(records.length).toBe(ASKS.length);
      // A misread may only cost the fast lane, never take a wrong one.
      expect(wrongFastLane).toBe(0);
    }, 120_000);
  },
);
