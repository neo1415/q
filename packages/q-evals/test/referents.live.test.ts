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
  createQTurnReader,
  situationHeader,
  type QSituationAsker,
  type QTurnReading,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";

/**
 * LIVE referents check (owner live test 7 Nov 2026, R2/R3; approved by the
 * integration owner: Anthropic only, the owner's 6 sentences plus 4
 * curveballs, cap $1.50). The real TURN_READER on the hosted reader model,
 * told the new situation (their own firm, the record on their screen, the
 * reference rule), graded by code on who and what each turn means.
 *
 * Off unless CQ_LIVE_MODEL_TESTS=1 and ANTHROPIC_API_KEY is set:
 *   CQ_LIVE_MODEL_TESTS=1 node scripts/live-model-tests.mjs packages/q-evals/test/referents.live.test.ts
 * CQ_REFERENTS_REPORT=<file>: the JSON summary (every case, its reading).
 * Stops before a case once the spend reaches the cap. Prints calls, tokens
 * and cost; never the key. Synthetic records only.
 */
const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEY = process.env["ANTHROPIC_API_KEY"];
const REPORT = process.env["CQ_REFERENTS_REPORT"];
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
      code: `fast_classification.referents.${sensitivityClass.toLowerCase()}`,
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

/** The ledger the reader is shown: Tensorgate opened earlier, Spheros talked about since. */
const STATE = [
  "LEDGER:",
  "E1 COMPANY Tensorgate: opened on screen (messages 2, 3)",
  "E2 COMPANY Spheros: said by them, said by Q (messages 6, 7, 8)",
  "E3 COMPANY Clearwater Assurance: Q's card (message 10)",
].join("\n");

type Turn = { readonly role: "USER" | "Q"; readonly text: string };
type Case = {
  readonly id: string;
  readonly said: string;
  readonly recent: readonly Turn[];
  readonly onScreen: string | null;
  /** True when the reading passes; why it failed otherwise. */
  readonly grade: (reading: QTurnReading | null) => true | string;
};

const named = (reading: QTurnReading | null): string =>
  [
    reading?.reference?.name ?? "",
    ...(reading?.references ?? []).map((one) => JSON.stringify(one ?? "")),
    JSON.stringify(reading?.namedOther ?? ""),
  ].join(" ");

const SPHEROS_TALK: readonly Turn[] = [
  { role: "USER", text: "tell me about spheros" },
  {
    role: "Q",
    text: "Spheros builds route-planning software for regional airlines; they're raising a seed round.",
  },
];

const CASES: readonly Case[] = [
  {
    id: "owner-1 their elevator (Spheros talked about and on screen)",
    said: "can i see their elevator",
    recent: SPHEROS_TALK,
    onScreen: "Spheros",
    grade: (r) =>
      /tensorgate/iu.test(named(r))
        ? `pointed at Tensorgate: ${named(r)}`
        : true,
  },
  {
    id: "owner-2 i meant me (Clearwater on screen)",
    said: "i meant me, what can you find about me online",
    recent: [
      { role: "USER", text: "what can you find about e online?" },
      {
        role: "Q",
        text: "Here are companies starting with E on Capital Q: Ekoline, Eden Health.",
      },
    ],
    onScreen: "Clearwater Assurance",
    grade: (r) =>
      /clearwater/iu.test(named(r))
        ? `bound me to Clearwater: ${named(r)}`
        : r?.aboutNamedOther === true
          ? "read as about someone else"
          : true,
  },
  {
    id: "owner-3 tensorgate's profile is not their own profile",
    said: "okay take me tensorgates profile",
    recent: SPHEROS_TALK,
    onScreen: null,
    grade: (r) =>
      r?.tool?.kind === "NAVIGATE" && r.tool.destination === "PROFILE"
        ? "navigated to their own profile"
        : true,
  },
  {
    id: "owner-4 their own firm's location",
    said: "where is Zino aviation located in nigeria?",
    recent: [],
    onScreen: null,
    grade: (r) =>
      r?.aboutNamedOther === true
        ? "read their own firm as someone else"
        : true,
  },
  {
    id: "owner-5 rehearse picks no company unasked",
    said: "i want to rehaearse",
    recent: [],
    onScreen: null,
    grade: (r) =>
      /tensorgate|spheros|clearwater/iu.test(r?.reference?.name ?? "")
        ? `picked a company: ${r?.reference?.name ?? ""}`
        : true,
  },
  {
    id: "owner-6 who viewed me is about them (Spheros on screen)",
    said: "who has viewed my profile?",
    recent: [],
    onScreen: "Spheros",
    grade: (r) =>
      /spheros/iu.test(r?.reference?.name ?? "")
        ? "bound my profile to the company on screen"
        : true,
  },
  {
    id: "curve-1 our website (Spheros on screen)",
    said: "what's our website again?",
    recent: [],
    onScreen: "Spheros",
    grade: (r) =>
      /spheros/iu.test(named(r))
        ? `bound our to Spheros: ${named(r)}`
        : r?.aboutNamedOther === true
          ? "read their own firm as someone else"
          : true,
  },
  {
    id: "curve-2 the conversation wins over the screen",
    said: "what do they do?",
    recent: [
      { role: "USER", text: "tell me about tensorgate" },
      {
        role: "Q",
        text: "Tensorgate makes GPU scheduling software; they raised a pre-seed in 2025.",
      },
    ],
    onScreen: "Spheros",
    grade: (r) =>
      /spheros/iu.test(named(r))
        ? `followed the screen over the conversation: ${named(r)}`
        : true,
  },
  {
    id: "curve-3 nothing named: the screen answers",
    said: "open it",
    recent: [],
    onScreen: "Spheros",
    grade: (r) =>
      /tensorgate|clearwater/iu.test(named(r))
        ? `pointed at a company not on screen or in the conversation: ${named(r)}`
        : true,
  },
  {
    id: "curve-4 my company is their own firm",
    said: "how is my fund doing this quarter?",
    recent: SPHEROS_TALK,
    onScreen: "Spheros",
    grade: (r) =>
      /spheros/iu.test(named(r))
        ? `bound my fund to Spheros: ${named(r)}`
        : true,
  },
];

describe.skipIf(!LIVE || KEY === undefined)(
  "live: who and what a turn means (R2/R3), on the real reader",
  () => {
    it("reads the owner's 6 sentences and 4 curveballs within $1.50", async () => {
      const usage = createInMemoryModelUsageRepository();
      const reader = createQTurnReader({
        gateway: createModelGateway({
          catalog: createStaticModelCatalog(catalog),
          registry: createModelProviderRegistry([
            createAnthropicModelProvider({ apiKey: KEY ?? "" }),
          ]),
          usage,
        }),
        logger: createLogger(
          { serviceName: "q-evals-live", environment: "test" },
          { level: "silent" },
        ),
      });
      const spentUsd = () =>
        usage.entries.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
      const results: {
        id: string;
        pass: boolean;
        why: string | null;
        reading: QTurnReading | null;
      }[] = [];
      for (const one of CASES) {
        if (spentUsd() >= CAP_USD) break;
        const situation = situationHeader({
          now: new Date(NOW),
          asker: {
            ...INVESTOR,
            onScreen:
              one.onScreen === null
                ? null
                : { kind: "COMPANY", name: one.onScreen },
          },
          surface: "CHAT",
          page: one.onScreen === null ? "HOME" : "COMPANY",
        });
        const reading = await reader
          .read({
            utterance: one.said,
            recentTurns: one.recent,
            modality: "TEXT",
            situation,
            conversationState: STATE,
            attribution: {
              tenantId: "c0000000-0000-4000-8000-000000000001",
              userId: "b0000000-0000-4000-8000-000000000001",
              correlationId: "cor_referents_live",
            },
          })
          .catch(() => null);
        const grade = one.grade(reading);
        results.push({
          id: one.id,
          pass: grade === true,
          why: grade === true ? null : grade,
          reading,
        });
      }
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
        `referents: ${String(summary.passed)}/${String(summary.cases)} passed; calls ${String(summary.calls)}; tokens in ${String(spent.input)} (cached ${String(spent.cached)}) out ${String(spent.output)}; cost $${spent.cost.toFixed(4)}`,
      );
      for (const miss of results.filter((r) => !r.pass)) {
        console.log(`  MISS ${miss.id}: ${miss.why ?? ""}`);
      }
      if (REPORT !== undefined) {
        writeFileSync(REPORT, `${JSON.stringify(summary, null, 2)}\n`);
      }
      expect(spent.cost).toBeLessThanOrEqual(CAP_USD + 0.25);
      expect(results).toHaveLength(CASES.length);
      expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
    }, 600_000);
  },
);
