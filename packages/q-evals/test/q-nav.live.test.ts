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
import {
  createQNavigationDecider,
  NAVIGATION_VOTES,
} from "@capital-q/model-gateway/q";

import { Q_NAV_DATASET } from "../src/datasets/q-nav/index.js";
import { navigationPipelineSubject, runQNav } from "../src/runner/q-nav.js";

/**
 * LIVE q-nav (plan W4.4; the owner's paid check, DECISIONS 62/73): the real
 * NAVIGATION_DECISION on the hosted NORMAL_DIALOGUE model (Claude Sonnet
 * 5.5 at its hosted price, reasoning MEDIUM), sampled NAVIGATION_VOTES
 * times in parallel and voted (DECISIONS 78), each sample through the real
 * resolution and hard constraints. Synthetic records only. Reports each
 * turn's decision latency (the slowest of its parallel samples, plus
 * resolution): p50 and p95.
 *
 * Off unless CQ_LIVE_MODEL_TESTS=1 and ANTHROPIC_API_KEY is set:
 *   CQ_LIVE_MODEL_TESTS=1 CQ_QNAV_SPLIT=dev node scripts/live-model-tests.mjs packages/q-evals/test/q-nav.live.test.ts
 * CQ_QNAV_SPLIT: dev (tuned against), heldout or heldout4 (each measured
 * once; heldout4 is the batch-8 set on conversation-driven placement; its misses
 * are reported by category only, never turn by turn, so nobody tunes
 * against it). CQ_QNAV_LIMIT=n: only the first n cases (a smoke run).
 * CQ_QNAV_REPORT=<file>: the JSON summary (dev: with every miss).
 * CQ_QNAV_CONCURRENCY=n: cases decided at once (default 4; latency is
 * per turn either way).
 * Prints calls, tokens, cost and the gates; never the key.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["ANTHROPIC_API_KEY"];
const SPLIT =
  process.env["CQ_QNAV_SPLIT"] === "heldout" ||
  process.env["CQ_QNAV_SPLIT"] === "heldout4"
    ? process.env["CQ_QNAV_SPLIT"]
    : "dev";
const LIMIT = Number(process.env["CQ_QNAV_LIMIT"] ?? "0");
const REPORT = process.env["CQ_QNAV_REPORT"];
const CONCURRENCY = Number(process.env["CQ_QNAV_CONCURRENCY"] ?? "4");

/** The p-th percentile (nearest rank) of milliseconds. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, rank)] ?? 0);
}
const NOW = "2026-11-06T00:00:00.000Z";
const PROVIDER = "a1000000-0000-4000-8000-000000000004";
const SONNET = "a2000000-0000-4000-8000-000000000030";

// The hosted rows (20261231280000_ai_ops_anthropic_claude_reasoning.sql).
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
      id: "a4000000-0000-4000-8000-000000000030",
      code: "normal_dialogue.v2",
      taskClass: "NORMAL_DIALOGUE",
      sensitivityClass: "CONFIDENTIAL",
      qualityFloor: "STANDARD",
      latencyTargetMs: 9_000,
      costCeilingUsd: 0.25,
      preferredModels: [SONNET],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 2,
    },
  ],
  loadedAt: NOW,
};

describe.skipIf(!LIVE || KEY === undefined)(
  "live: q-nav through the real decision, resolution and hard constraints",
  () => {
    it(`decides the ${SPLIT} split and reports the gates and the cost`, async () => {
      const usage = createInMemoryModelUsageRepository();
      const decider = createQNavigationDecider({
        gateway: createModelGateway({
          catalog: createStaticModelCatalog(catalog),
          registry: createModelProviderRegistry([
            createAnthropicModelProvider({ apiKey: KEY ?? "" }),
          ]),
          usage,
        }),
      });
      const all = Q_NAV_DATASET.cases.filter((c) => c.split === SPLIT);
      const cases = LIMIT > 0 ? all.slice(0, LIMIT) : all;
      // What the model proposed per turn (each sample), before resolution
      // and policy.
      const proposed = new Map<string, unknown[]>();
      const subject = navigationPipelineSubject(
        `live:${SPLIT}`,
        async (turn, navigation) => {
          const proposal = await decider.decide(navigation, {
            tenantId: "c0000000-0000-4000-8000-000000000001",
            // One person per side, as in production (a person is one
            // side): each side's prompt cache holds its own site map.
            userId:
              turn.side === "INVESTOR"
                ? "c0000000-0000-4000-8000-000000000002"
                : "c0000000-0000-4000-8000-000000000003",
            correlationId: `cor_live_qnav_${SPLIT}`,
          });
          const key = `${turn.caseId}#${String(turn.history.length)}`;
          proposed.set(key, [...(proposed.get(key) ?? []), proposal]);
          return proposal;
        },
        { movesAllowed: true },
        NAVIGATION_VOTES,
      );
      const latencies: number[] = [];
      const run = await runQNav(
        {
          ...subject,
          decide: async (input) => {
            const started = performance.now();
            try {
              return await subject.decide(input);
            } finally {
              latencies.push(performance.now() - started);
            }
          },
        },
        cases,
        { concurrency: CONCURRENCY },
      );
      const latency = {
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        maxMs: percentile(latencies, 100),
        votes: NAVIGATION_VOTES,
        concurrency: CONCURRENCY,
      };
      const spent = usage.entries.reduce(
        (sum, r) => ({
          input: sum.input + r.inputTokens,
          cached: sum.cached + r.cachedInputTokens,
          output: sum.output + r.outputTokens,
          cost: sum.cost + (r.costUsd ?? 0),
        }),
        { input: 0, cached: 0, output: 0, cost: 0 },
      );
      const misses = run.grades.filter((g) => !g.pass);
      const byCategory: Record<string, number> = {};
      for (const g of misses)
        byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
      console.log(
        [
          `q-nav live ${SPLIT}: ${String(run.grades.length)} turns, ${String(misses.length)} misses`,
          `by category ${JSON.stringify(byCategory)}`,
          `labs gate ${String(run.summary.labsGate)}; on gate ${String(run.summary.onGate)}`,
          `latency p50 ${String(latency.p50Ms)} ms, p95 ${String(latency.p95Ms)} ms, max ${String(latency.maxMs)} ms (${String(NAVIGATION_VOTES)} samples in parallel per turn)`,
          `calls ${String(usage.entries.length)}; tokens in ${String(spent.input)} (cached ${String(spent.cached)}) out ${String(spent.output)}; cost $${spent.cost.toFixed(4)}`,
        ].join("\n"),
      );
      if (REPORT !== undefined)
        writeFileSync(
          REPORT,
          JSON.stringify(
            {
              split: SPLIT,
              turns: run.grades.length,
              summary: run.summary,
              missesByCategory: byCategory,
              calls: usage.entries.length,
              tokens: spent,
              latency,
              // Held-out misses are never listed turn by turn.
              misses:
                SPLIT === "dev"
                  ? misses.map((g) => ({
                      id: `${g.caseId}#${String(g.turn)}`,
                      category: g.category,
                      reasons: g.reasons,
                      // The model's own proposals (decision, place, reason),
                      // one per sample.
                      proposed:
                        proposed.get(`${g.caseId}#${String(g.turn)}`) ?? null,
                    }))
                  : undefined,
            },
            null,
            2,
          ),
        );
      // A measurement: the plan's gates are the report, not this assertion.
      expect(run.grades.length).toBeGreaterThan(0);
    }, 10_800_000);
  },
);
