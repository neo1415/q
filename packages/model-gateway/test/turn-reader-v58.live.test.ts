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
 * LIVE eval (not run without approval): TURN_READER v58 reads, by meaning,
 * (a) whom a turn is about -- a "Yes" to Q's offer about a company is that
 * company or no one, never "Yes"; a lowercase name is spelled properly --
 * and (b) Lane 4's mandate cases: an investor asking which companies to look
 * into or invest in is DISCOVER ranking FIT with mandateRelevant true. Run
 * only by `pnpm test:live-model` with CQ_LIVE_MODEL_TESTS=1 and a Gemini
 * key; synthetic sentences only (about 13 short reads).
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

type Turn = { readonly role: "USER" | "Q"; readonly text: string };

/** The reading's fields this eval checks, read loosely from the result. */
type Read = {
  readonly namedOther?: { readonly name: string; readonly kind: string } | null;
  readonly question?: {
    readonly kind?: string;
    readonly count?: number | null;
    readonly discover?: {
      readonly ranking?: string;
      readonly mandateRelevant?: boolean;
      readonly previous?: boolean;
      readonly raising?: boolean;
      readonly sectors?: readonly string[];
    } | null;
  } | null;
};

const ZINO_OFFER: readonly Turn[] = [
  { role: "USER", text: "Tell me about Zino Aviation" },
  {
    role: "Q",
    text: "Zino Aviation is a Lagos aviation company training pilots and running charters. Want to dig into its fit details?",
  },
];

const SHOWN_LIST: readonly Turn[] = [
  { role: "USER", text: "Show me three fintech companies" },
  {
    role: "Q",
    text: "Here are three fintech companies: Ledgerfold, Basketari and Brancheon Works.",
  },
];

describe.skipIf(!LIVE || GEMINI === undefined)(
  "live: TURN_READER v58 reads whom and what by meaning",
  () => {
    it(
      "names the subject from context and reads Lane 4's mandate cases",
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
        const read = async (
          utterance: string,
          recentTurns: readonly Turn[] = [],
        ): Promise<Read | null> =>
          (await reader.read({
            utterance,
            recentTurns: [...recentTurns],
            modality: "TEXT",
            actions: [],
            attribution: {
              tenantId: "c0000000-0000-4000-8000-000000000001",
              userId: "b0000000-0000-4000-8000-000000000001",
              correlationId: "cor_live_eval",
            },
          })) as Read | null;
        const misses: string[] = [];
        const miss = (said: string, why: string, got: unknown) => {
          misses.push(`"${said}": ${why} (got ${JSON.stringify(got)})`);
        };

        // (a) Whom the turn is about.
        const yes = await read("Yes", ZINO_OFFER);
        const yesName = yes?.namedOther?.name ?? null;
        if (yesName !== null && !/zino/iu.test(yesName)) {
          miss("Yes", "subject is neither Zino nor null", yes?.namedOther);
        }
        const lower = await read("tell me about zino aviation");
        if (lower?.namedOther?.name !== "Zino Aviation") {
          miss(
            "tell me about zino aviation",
            "not Zino Aviation",
            lower?.namedOther,
          );
        }
        const captain = await read("Who is Captain Zino Mario?");
        if (
          captain?.namedOther?.kind !== "PERSON" ||
          !/zino mario/iu.test(captain.namedOther.name)
        ) {
          miss(
            "Who is Captain Zino Mario?",
            "not the person",
            captain?.namedOther,
          );
        }

        // (b) Lane 4: what suits an investor (all said as an investor).
        const fit = async (
          said: string,
          expected: {
            readonly kind: "DISCOVER_COMPANIES" | "FIT";
            readonly ranking?: string;
            readonly mandateRelevant: boolean;
            readonly count?: number;
            readonly previous?: boolean;
            readonly sector?: string;
            readonly raising?: boolean;
          },
          recentTurns: readonly Turn[] = [],
        ) => {
          const r = await read(said, recentTurns);
          const q = r?.question ?? null;
          const d = q?.discover ?? null;
          if (
            q?.kind !== expected.kind ||
            (expected.ranking !== undefined &&
              d?.ranking !== expected.ranking) ||
            (d?.mandateRelevant ?? false) !== expected.mandateRelevant ||
            (expected.count !== undefined && q.count !== expected.count) ||
            (expected.previous !== undefined &&
              (d?.previous ?? false) !== expected.previous) ||
            (expected.sector !== undefined &&
              !(d?.sectors ?? []).includes(expected.sector)) ||
            (expected.raising !== undefined &&
              (d?.raising ?? false) !== expected.raising)
          ) {
            miss(said, `expected ${JSON.stringify(expected)}`, q);
          }
        };
        await fit(
          "Can you help me find like... Like three companies that's I should look into",
          {
            kind: "DISCOVER_COMPANIES",
            ranking: "FIT",
            mandateRelevant: true,
            count: 3,
          },
        );
        await fit("What should I invest in?", {
          kind: "DISCOVER_COMPANIES",
          ranking: "FIT",
          mandateRelevant: true,
        });
        await fit("Find me 3 companies", {
          kind: "DISCOVER_COMPANIES",
          ranking: "FIT",
          mandateRelevant: true,
          count: 3,
        });
        await fit("Show me three fintech companies", {
          kind: "DISCOVER_COMPANIES",
          ranking: "NONE",
          mandateRelevant: false,
          sector: "fintech",
        });
        await fit(
          "Oh, can you rank them for me, please? Like I'm talking of the top three based on my mandate",
          { kind: "FIT", mandateRelevant: true, count: 3, previous: true },
          SHOWN_LIST,
        );
        // Lane 4: name order and "raising now", by meaning.
        await fit("List the fintech companies alphabetically", {
          kind: "DISCOVER_COMPANIES",
          ranking: "NAME",
          mandateRelevant: false,
          sector: "fintech",
        });
        await fit("Any fintech companies in Nigeria raising a seed round?", {
          kind: "DISCOVER_COMPANIES",
          mandateRelevant: false,
          sector: "fintech",
          raising: true,
        });
        await fit("Quels startups healthtech lèvent des fonds en ce moment ?", {
          kind: "DISCOVER_COMPANIES",
          mandateRelevant: false,
          raising: true,
        });
        expect(misses).toEqual([]);
      },
      5 * 60_000,
    );
  },
);
