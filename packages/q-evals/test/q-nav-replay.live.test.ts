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
  decideNavigation,
  navigationSiteMap,
  situationHeader,
  type QNavigationInput,
  type QNavigationRecordResolver,
} from "@capital-q/model-gateway/q";
import type { QNavigateTarget } from "@capital-q/contracts";

/**
 * LIVE: the owner's batch-7 replay sentences (7 Nov 2026) through the real
 * NAVIGATION_DECISION (active version, three votes, MEDIUM), the same
 * situation the answer reads, and the production policy. The companies are
 * NOT in the person's held records (as on Discover); code finds them by
 * name, as open_page does for the person. Hard cap: stops past $1.
 *
 *   CQ_LIVE_MODEL_TESTS=1 node scripts/live-model-tests.mjs packages/q-evals/test/q-nav-replay.live.test.ts
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["ANTHROPIC_API_KEY"];
const CAP_USD = 1;
const NOW = "2026-11-06T00:00:00.000Z";
const PROVIDER = "a1000000-0000-4000-8000-000000000004";
const SONNET = "a2000000-0000-4000-8000-000000000030";

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

const HARBOURLINE = "c1000000-0000-4000-8000-000000000001";
const CLINICREST = "c1000000-0000-4000-8000-000000000002";
const WORLD = [
  { id: HARBOURLINE, name: "Harbourline Cargo" },
  { id: CLINICREST, name: "Clinicrest" },
];

/** open_page's own find, as the person: a company they may open, by name. */
const resolver: QNavigationRecordResolver = (ask) => {
  const said = ask.name.toLowerCase().replace(/[^a-z]/gu, "");
  const found = WORLD.filter((c) => {
    const key = c.name.toLowerCase().replace(/[^a-z]/gu, "");
    return said.includes(key) || key.includes(said);
  });
  return Promise.resolve(
    ask.kind === "COMPANY" && found.length === 1 && found[0] !== undefined
      ? { status: "FOUND", recordId: found[0].id, documentId: null }
      : { status: "NONE" },
  );
};

type Case = {
  readonly said: string;
  readonly at: QNavigateTarget;
  readonly onScreen: string | null;
  readonly earlier?: readonly { readonly user: string; readonly q: string }[];
  readonly want:
    | { readonly decision: "STAY" }
    | {
        readonly decision: "MOVE";
        readonly page: string;
        readonly recordId?: string;
        readonly tab?: string;
      };
};

const DISCOVER: QNavigateTarget = { page: "DISCOVER" };
const harbour = (tab = "overview"): QNavigateTarget => ({
  page: "COMPANY",
  recordId: HARBOURLINE,
  tab,
});
const clinic = (tab = "overview"): QNavigateTarget => ({
  page: "COMPANY",
  recordId: CLINICREST,
  tab,
});

const CASES: readonly Case[] = [
  {
    said: "i want to see harbourline cargo's pitch deck",
    at: DISCOVER,
    onScreen: null,
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: HARBOURLINE,
      tab: "deck",
    },
  },
  {
    said: "okay take me to harbourline cargos profile",
    at: DISCOVER,
    onScreen: null,
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: HARBOURLINE,
      tab: "overview",
    },
  },
  {
    said: "i'm curious about their team",
    at: harbour(),
    onScreen: "Harbourline Cargo",
    earlier: [
      {
        user: "okay take me to harbourline cargos profile",
        q: "Here is Harbourline Cargo.",
      },
    ],
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: HARBOURLINE,
      tab: "team",
    },
  },
  {
    said: "can i see it?",
    at: harbour(),
    onScreen: "Harbourline Cargo",
    earlier: [
      {
        user: "i'm curious about their team",
        q: "Harbourline Cargo's team is led by its two founders.",
      },
    ],
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: HARBOURLINE,
      tab: "team",
    },
  },
  {
    said: "tell me about clinicrest",
    at: harbour("team"),
    onScreen: "Harbourline Cargo",
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: CLINICREST,
      tab: "overview",
    },
  },
  {
    said: "can i see their elevator",
    at: clinic(),
    onScreen: "Clinicrest",
    earlier: [
      {
        user: "tell me about clinicrest",
        q: "Clinicrest runs clinics for small towns.",
      },
    ],
    want: {
      decision: "MOVE",
      page: "COMPANY",
      recordId: CLINICREST,
      tab: "elevator",
    },
  },
  {
    said: "who has viewed my profile?",
    at: clinic(),
    onScreen: "Clinicrest",
    want: { decision: "MOVE", page: "ANALYTICS" },
  },
  {
    said: "what can you find about me online?",
    at: DISCOVER,
    onScreen: null,
    want: { decision: "STAY" },
  },
];

describe.skipIf(!LIVE || KEY === undefined)(
  "live: the owner's batch-7 replay sentences place the page (cap $1)",
  () => {
    it("decides each sentence, and reports what it did and the cost", async () => {
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
      const spent = () =>
        usage.entries.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
      const results: string[] = [];
      let passed = 0;
      for (const c of CASES) {
        if (spent() > CAP_USD - 0.15) {
          results.push(`STOPPED at $${spent().toFixed(3)} before: ${c.said}`);
          break;
        }
        const input: QNavigationInput = {
          utterance: c.said,
          recentTurns: c.earlier ?? [],
          side: "INVESTOR",
          pane: {
            at: c.at,
            previous: null,
            pane: "OPEN",
            dirty: false,
            busy: null,
          },
          pageText: null,
          // As on Discover: none of these companies is in their held records.
          records: { companies: [], investors: [], things: [], deleted: [] },
          siteMap: navigationSiteMap("INVESTOR"),
          situation: situationHeader({
            now: new Date(NOW),
            asker: {
              displayName: "Amara Diallo-Benson",
              role: "INVESTOR",
              organisation: "Savanna Seed Partners",
              timeZone: null,
              ...(c.onScreen === null
                ? {}
                : { onScreen: { kind: "COMPANY" as const, name: c.onScreen } }),
            },
            surface: "DOCK",
            page: null,
          }),
        };
        const started = performance.now();
        const outcome = await decideNavigation(
          {
            decider,
            canOpen: () => true,
            config: { movesAllowed: true },
            resolver,
          },
          input,
          {
            tenantId: "c0000000-0000-4000-8000-000000000001",
            userId: "c0000000-0000-4000-8000-000000000002",
            correlationId: "cor_live_qnav_replay",
          },
        );
        const ms = Math.round(performance.now() - started);
        const want = c.want;
        const ok =
          want.decision === "STAY"
            ? outcome.decision === "STAY"
            : outcome.decision === "MOVE" &&
              outcome.target?.page === want.page &&
              (want.recordId === undefined ||
                outcome.target.recordId === want.recordId) &&
              (want.tab === undefined || outcome.target.tab === want.tab);
        if (ok) passed += 1;
        results.push(
          `${ok ? "PASS" : "MISS"} ${String(ms)} ms "${c.said}" -> ${outcome.decision} ${JSON.stringify(outcome.target)} guard ${String(outcome.guard)}`,
        );
      }
      console.log(
        [
          ...results,
          `q-nav replay live: ${String(passed)}/${String(CASES.length)}; calls ${String(usage.entries.length)}; cost $${spent().toFixed(4)}`,
        ].join("\n"),
      );
      expect(spent()).toBeLessThan(CAP_USD);
    }, 600_000);
  },
);
