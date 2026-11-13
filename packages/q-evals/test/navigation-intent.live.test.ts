import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";
import { createAnthropicModelProvider } from "@capital-q/model-gateway/providers/anthropic";
import {
  createQTurnReader,
  situationHeader,
  type QSituationAsker,
  type QTurnReading,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";

import {
  gradeNavigationIntent,
  NAVIGATION_INTENT_CASES,
} from "../src/datasets/navigation-intent/cases.js";

/**
 * LIVE navigation-intent check (C10, owner directive 13 Nov 2026: semantic
 * intent, not keyword routing). The real TURN_READER (v84) on the hosted
 * reader model reads each case once; code grades the typed `navigation`
 * intent (mode, negated, and parts for a multi-part turn) against the
 * dataset. No LLM judge. Synthetic, fictional companies only.
 *
 * Off unless CQ_LIVE_MODEL_TESTS=1 and ANTHROPIC_API_KEY is set:
 *   CQ_LIVE_MODEL_TESTS=1 node scripts/live-model-tests.mjs packages/q-evals/test/navigation-intent.live.test.ts
 * CQ_NAVIGATION_INTENT_REPORT=<file>: the JSON summary (every case, its
 * reading). Stops before a case once the spend reaches the cap. Prints
 * calls, tokens and cost; never the key.
 */
const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["ANTHROPIC_API_KEY"];
const REPORT = process.env["CQ_NAVIGATION_INTENT_REPORT"];
const CAP_USD = 1.5;

const NOW = "2026-11-07T16:30:00.000Z";
const PROVIDER = "a1000000-0000-4000-8000-000000000004";
const SONNET = "a2000000-0000-4000-8000-000000000020";

const catalog: ModelCatalogSnapshot = {
  providers: [
    {
      id: PROVIDER,
      code: "anthropic",
      name: "Anthropic",
      status: "ACTIVE",
      privacyPolicyClass: "NO_TRAINING_DEFAULT_RETENTION",
      supportsZeroRetention: false,
      regionSupport: [],
      ownerApprovedCeiling: "CONFIDENTIAL",
    },
  ],
  models: [
    {
      id: SONNET,
      providerId: PROVIDER,
      modelCode: "claude-sonnet-5-5",
      modelFamily: "claude-sonnet",
      modelType: "TEXT_GENERATION",
      status: "ACTIVE",
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsAudio: false,
      supportsRealtime: false,
      supportsPromptCache: true,
      supportsReasoning: true,
      sensitivityCeiling: "CONFIDENTIAL",
      qualityClass: "HIGH",
      latencyClass: "STANDARD",
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  // Conservative stand-in prices so the cap errs on the safe side.
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000031",
      modelId: SONNET,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 3,
      cachedInputPerMillion: 0.3,
      outputPerMillion: 15,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  routingPolicies: (["PUBLIC", "INTERNAL", "CONFIDENTIAL"] as const).map(
    (sensitivityClass, index) => ({
      id: `a4000000-0000-4000-8000-00000000004${String(index)}`,
      code: `fast_classification_navigation_intent_${sensitivityClass.toLowerCase()}.v1`,
      taskClass: "FAST_CLASSIFICATION" as const,
      sensitivityClass,
      qualityFloor: "STANDARD" as const,
      latencyTargetMs: 9_000,
      costCeilingUsd: 0.25,
      preferredModels: [SONNET],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE" as const,
      version: 1,
    }),
  ),
  loadedAt: NOW,
};

const INVESTOR: QSituationAsker = {
  displayName: "Zino Ade",
  role: "INVESTOR",
  organisation: "Zino Aviation",
  timeZone: "Africa/Lagos",
  own: {
    kind: "INVESTOR_ORGANISATION",
    city: null,
    country: "NG",
    website: "https://zino.aero",
  },
};

type CaseResult = {
  id: string;
  pass: boolean;
  why: string | null;
  reading: QTurnReading | null;
};

/** Every case through the real reader on the given provider, within the cap. */
async function runCases(
  provider: Parameters<typeof createModelProviderRegistry>[0][number],
): Promise<{
  readonly results: CaseResult[];
  readonly usage: ReturnType<typeof createInMemoryModelUsageRepository>;
}> {
  const usage = createInMemoryModelUsageRepository();
  const reader = createQTurnReader({
    gateway: createModelGateway({
      catalog: createStaticModelCatalog(catalog),
      registry: createModelProviderRegistry([provider]),
      usage,
    }),
    logger: createLogger(
      { serviceName: "q-evals-live", environment: "test" },
      { level: "silent" },
    ),
  });
  const spentUsd = () =>
    usage.entries.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const results: CaseResult[] = [];
  for (const one of NAVIGATION_INTENT_CASES) {
    if (spentUsd() >= CAP_USD) break;
    const reading = await reader
      .read({
        utterance: one.said,
        recentTurns: one.recent,
        modality: one.modality ?? "TEXT",
        situation: situationHeader({
          now: new Date(NOW),
          asker: { ...INVESTOR, onScreen: null },
          surface: "CHAT",
          page: "HOME",
        }),
        attribution: {
          tenantId: "c0000000-0000-4000-8000-000000000001",
          userId: "b0000000-0000-4000-8000-000000000001",
          correlationId: "cor_navigation_intent_live",
        },
      })
      .catch(() => null);
    const grade = gradeNavigationIntent(one.expected, reading);
    results.push({
      id: one.id,
      pass: grade === true,
      why: grade === true ? null : grade,
      reading,
    });
  }
  return { results, usage };
}

describe("the navigation-intent check runs end to end ($0, no provider)", () => {
  it("is a valid static catalog and runs end to end on a scripted model", async () => {
    expect(() => createStaticModelCatalog(catalog)).not.toThrow();
    const { results } = await runCases(
      createFakeModelProvider({
        code: "anthropic",
        script: [
          {
            kind: "JSON",
            value: {
              kind: "QUESTION_TO_Q",
              confidence: "HIGH",
              transcript: "CLEAR",
              question: null,
              aboutNamedOther: false,
              tool: null,
            },
          },
        ],
      }),
    );
    expect(results).toHaveLength(NAVIGATION_INTENT_CASES.length);
    expect(results.filter((r) => r.reading === null).map((r) => r.id)).toEqual(
      [],
    );
  });
});

describe.skipIf(!LIVE || KEY === undefined)(
  "live: the navigation intent on the real reader (TURN_READER v84)",
  () => {
    it("reads every case's typed navigation intent within $1.50", async () => {
      const { results, usage } = await runCases(
        createAnthropicModelProvider({ apiKey: KEY ?? "" }),
      );
      const spent = usage.entries.reduce(
        (sum, r) => ({
          input: sum.input + r.inputTokens,
          cached: sum.cached + r.cachedInputTokens,
          output: sum.output + r.outputTokens,
          cost: sum.cost + (r.costUsd ?? 0),
        }),
        { input: 0, cached: 0, output: 0, cost: 0 },
      );
      const summary = {
        at: new Date().toISOString(),
        cases: results.length,
        passed: results.filter((r) => r.pass).length,
        calls: usage.entries.length,
        tokens: spent,
        results,
      };
      console.log(
        `navigation-intent: ${String(summary.passed)}/${String(summary.cases)} passed; calls ${String(summary.calls)}; tokens in ${String(spent.input)} (cached ${String(spent.cached)}) out ${String(spent.output)}; cost $${spent.cost.toFixed(4)}`,
      );
      for (const miss of results.filter((r) => !r.pass)) {
        console.log(`  MISS ${miss.id}: ${miss.why ?? ""}`);
      }
      if (REPORT !== undefined) {
        writeFileSync(REPORT, `${JSON.stringify(summary, null, 2)}\n`);
      }
      expect(spent.cost).toBeLessThanOrEqual(CAP_USD + 0.25);
      expect(results).toHaveLength(NAVIGATION_INTENT_CASES.length);
      expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
    }, 900_000);
  },
);
