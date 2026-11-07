import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelCatalogSnapshot,
} from "@capital-q/model-gateway";
import { createAnthropicModelProvider } from "@capital-q/model-gateway/providers/anthropic";
import { createOnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";

import { LONG_ANSWER_DATASET } from "../src/datasets/onboarding-long-answer/index.js";
import {
  readerLongAnswerSubject,
  runLongAnswer,
} from "../src/runner/onboarding-long-answer.js";

/**
 * LIVE ONBOARDING-LONG-ANSWER (onboarding P1-1; the owner's paid check,
 * DECISIONS 72/73): the real ONBOARDING_TRANSCRIPT_READER (v14, the active
 * version) through the Q Model Gateway, on Anthropic only, Claude Sonnet
 * 5.5 at its hosted price (no small model, DECISIONS 73). Synthetic cases
 * only. Approved cap $2; this run stops itself before $1.80.
 *
 * The key is read from ANTHROPIC_API_KEY in this process's environment and
 * nowhere else (not .env.local, not Railway, not any file), so run it with
 * vitest directly, never through scripts/live-model-tests.mjs:
 *
 *   CQ_LIVE_MODEL_TESTS=1 ANTHROPIC_API_KEY=... pnpm exec vitest run \
 *     --config vitest.live-model.config.ts \
 *     packages/q-evals/test/onboarding-long-answer.live.test.ts
 *
 * CQ_LONG_ANSWER_SPLIT: all (default), dev or heldout (held-out misses are
 * reported by category only, never case by case). CQ_LONG_ANSWER_REPORT=<file>:
 * a JSON summary. Prints calls, tokens and the exact cost; never the key.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["ANTHROPIC_API_KEY"];
const SPLIT_ENV = process.env["CQ_LONG_ANSWER_SPLIT"];
const SPLIT =
  SPLIT_ENV === "dev" || SPLIT_ENV === "heldout" ? SPLIT_ENV : "all";
const REPORT = process.env["CQ_LONG_ANSWER_REPORT"];
/** The run stops before a reading could take the spend past this. */
const STOP_AT_USD = 1.8;
/** One reading's worst case: the reader's per-call ceiling, two attempts. */
const READING_CEILING_USD = 0.1;
const NOW = "2026-11-07T00:00:00.000Z";
const PROVIDER = "a1000000-0000-4000-8000-000000000004";
const SONNET = "a2000000-0000-4000-8000-000000000030";

// The hosted Anthropic rows (20261231280000_ai_ops_anthropic_claude_
// reasoning.sql), with STRUCTURED_EXTRACTION (the reader's task class) on
// Sonnet as 20261231360000 (Claude backup, Sonnet throughout) routes it.
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
  prices: [
    {
      id: "a3000000-0000-4000-8000-000000000030",
      modelId: SONNET,
      pricingRegion: "global",
      currency: "USD",
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      outputPerMillion: 10,
      effectiveFrom: NOW,
      effectiveTo: null,
    },
  ],
  routingPolicies: [
    {
      id: "a4000000-0000-4000-8000-000000000031",
      code: "structured_extraction.v2",
      taskClass: "STRUCTURED_EXTRACTION",
      sensitivityClass: "CONFIDENTIAL",
      qualityFloor: "STANDARD",
      latencyTargetMs: 25_000,
      costCeilingUsd: 0.05,
      preferredModels: [SONNET],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 2,
    },
  ],
  loadedAt: NOW,
};

describe.skipIf(!LIVE)(
  "live: the onboarding transcript reader judges when to summarise (P1-1)",
  () => {
    it(`reads the ${SPLIT} cases and reports the graders and the exact cost`, async () => {
      // Refuses to run without the key from the environment: no fallback,
      // no search for one anywhere else.
      if (KEY === undefined || KEY.trim().length === 0) {
        throw new Error(
          "Refusing to run: ANTHROPIC_API_KEY is not set in this process's environment (the only place this eval reads a key from).",
        );
      }
      const usage = createInMemoryModelUsageRepository();
      const spent = () =>
        usage.entries.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const reader = createOnboardingTranscriptReader({
        gateway: createModelGateway({
          catalog: createStaticModelCatalog(catalog),
          registry: createModelProviderRegistry([
            createAnthropicModelProvider({ apiKey: KEY }),
          ]),
          usage,
        }),
        logger: createLogger(
          { serviceName: "q-evals-live", environment: "test" },
          { level: "warn" },
        ),
        dataPosture: "SYNTHETIC_DEMO",
        now: () => new Date(NOW),
      });
      const cases = LONG_ANSWER_DATASET.cases.filter(
        (c) => SPLIT === "all" || c.split === SPLIT,
      );
      const run = await runLongAnswer(
        readerLongAnswerSubject(reader, {
          tenantId: "c0000000-0000-4000-8000-000000000001",
          userId: "c0000000-0000-4000-8000-000000000003",
          correlationId: `cor_live_long_answer_${SPLIT}`,
        }),
        cases,
        { stop: () => spent() + READING_CEILING_USD > STOP_AT_USD },
      );
      const tokens = usage.entries.reduce(
        (sum, r) => ({
          input: sum.input + r.inputTokens,
          cached: sum.cached + r.cachedInputTokens,
          output: sum.output + r.outputTokens,
        }),
        { input: 0, cached: 0, output: 0 },
      );
      const lines = [];
      for (const split of ["dev", "heldout"] as const) {
        const grades = run.grades.filter((g) => g.split === split);
        if (grades.length === 0) continue;
        const passed = grades.filter((g) => g.pass).length;
        const decisions = grades.filter((g) => g.decisionExact).length;
        const outcomes = grades.filter((g) => g.outcomeExact).length;
        const unsafe = grades.filter((g) => g.unsafeSave).length;
        const byCategory: Record<string, number> = {};
        for (const g of grades)
          if (!g.pass)
            byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
        lines.push(
          `${split}: ${String(passed)}/${String(grades.length)} steps pass; decision ${String(decisions)}/${String(grades.length)}; code outcome ${String(outcomes)}/${String(grades.length)}; unsafe saves ${String(unsafe)}; misses by category ${JSON.stringify(byCategory)}`,
        );
      }
      lines.push(
        `calls ${String(usage.entries.length)}; tokens in ${String(tokens.input)} (cached ${String(tokens.cached)}) out ${String(tokens.output)}; cost $${spent().toFixed(4)}`,
        run.skipped.length === 0
          ? "no case skipped"
          : `stopped at the $${STOP_AT_USD.toFixed(2)} cap: ${String(run.skipped.length)} cases not run`,
      );
      console.log(`onboarding-long-answer live\n${lines.join("\n")}`);
      if (REPORT !== undefined)
        writeFileSync(
          REPORT,
          JSON.stringify(
            {
              split: SPLIT,
              summary: run.summary,
              calls: usage.entries.length,
              tokens,
              costUsd: spent(),
              skipped: run.skipped,
              // Held-out misses are never listed case by case.
              devMisses: run.grades
                .filter((g) => g.split === "dev" && !g.pass)
                .map((g) => ({
                  id: `${g.caseId}/${g.stepKey}`,
                  category: g.category,
                  reasons: g.reasons,
                })),
            },
            null,
            2,
          ),
        );
      expect(spent()).toBeLessThanOrEqual(STOP_AT_USD);
      expect(run.grades.length).toBeGreaterThan(0);
    }, 3_600_000);
  },
);
