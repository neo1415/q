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
import { createQDelegationReader } from "../src/q/index.js";

/**
 * LIVE eval: what a turn's words establish, read by DELEGATION_READER v2,
 * across paraphrases (ACC 2026-09-25). The deterministic suites prove what
 * code permits given a reading; this measures whether the reading itself
 * holds when the wording changes. Run only by `pnpm test:live-model`
 * (CQ_LIVE_MODEL_TESTS=1 and a Gemini key); synthetic sentences only.
 *
 * The safety side is strict: no question, advice request or mention may
 * read as a statement of the step it touches. Every miss is listed.
 */

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const GEMINI = process.env["GEMINI_API_KEY"];

const NOW = "2026-09-25T00:00:00.000Z";
const IDS = {
  google: "a1000000-0000-4000-8000-000000000001",
  flashLite: "a2000000-0000-4000-8000-000000000001",
};
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
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    },
  ],
  loadedAt: NOW,
};

const STEPS = [
  {
    stepKey: "I1.deployment_status",
    question: "Are you deploying capital right now?",
    about: "Actively investing, selective, paused or exploring only.",
    required: true,
  },
  {
    stepKey: "I0.business_title",
    question: "What's your role there?",
    about: "Their own title at their organisation.",
    required: false,
  },
  {
    stepKey: "I2.cheque_typical",
    question: "What's a typical cheque for you?",
    about: "Their usual cheque size.",
    required: false,
  },
  {
    stepKey: "I3.geography",
    question: "Where do you invest?",
    about: "Countries or regions they invest in.",
    required: false,
  },
  {
    stepKey: "I7.avoid",
    question: "What would you rather not see?",
    about: "A soft negative: these can still appear, ranked lower.",
    required: false,
  },
  {
    stepKey: "I7.hard_exclusions",
    question: "Is there anything you never want to be shown?",
    about: "A hard exclusion: not shown in standard discovery.",
    required: false,
  },
  {
    stepKey: "I7.sector_exclusions",
    question: "Are there sectors to exclude outright?",
    about: "A hard exclusion of taxonomy sectors.",
    required: false,
  },
];

type Case = {
  readonly utterance: string;
  readonly lastQ?: string;
  readonly step: string;
  readonly expect: "stated" | "not-stated" | "handed" | "declined";
};

const CASES: readonly Case[] = [
  // Questions and advice that touch a step's subject: never stated.
  {
    utterance: "Which sectors are pulling seed money in Kenya right now?",
    step: "I3.geography",
    expect: "not-stated",
  },
  {
    utterance: "what are angels in nairobi backing these days",
    step: "I3.geography",
    expect: "not-stated",
  },
  {
    utterance: "What's a typical cheque for pre-seed these days?",
    step: "I2.cheque_typical",
    expect: "not-stated",
  },
  {
    utterance: "is 50k normal for an angel cheque?",
    step: "I2.cheque_typical",
    expect: "not-stated",
  },
  {
    utterance: "Should an angel be selective in this market?",
    step: "I1.deployment_status",
    expect: "not-stated",
  },
  {
    utterance: "Do most angels exclude gambling?",
    step: "I7.hard_exclusions",
    expect: "not-stated",
  },
  {
    utterance: "What title do angels usually give themselves?",
    step: "I0.business_title",
    expect: "not-stated",
  },
  // Statements about themselves: stated.
  {
    utterance: "I only invest in Kenya and Ghana.",
    step: "I3.geography",
    expect: "stated",
  },
  {
    utterance: "usually around fifty thousand dollars",
    lastQ: "What's a typical cheque for you?",
    step: "I2.cheque_typical",
    expect: "stated",
  },
  {
    utterance: "yes",
    lastQ: "A typical cheque of $50,000 — is that right?",
    step: "I2.cheque_typical",
    expect: "stated",
  },
  {
    utterance: "I'm being pretty selective at the moment",
    step: "I1.deployment_status",
    expect: "stated",
  },
  {
    utterance: "Never show me gambling.",
    step: "I7.hard_exclusions",
    expect: "stated",
  },
  {
    utterance: "I'm a partner there",
    lastQ: "What's your role there?",
    step: "I0.business_title",
    expect: "stated",
  },
  // Handed over.
  {
    utterance: "Pick three exclusions you think fit me and go with those.",
    step: "I7.hard_exclusions",
    expect: "handed",
  },
  {
    utterance: "just choose a sensible typical cheque for me",
    step: "I2.cheque_typical",
    expect: "handed",
  },
  // Declined.
  {
    utterance: "no preference",
    lastQ: "Where do you invest?",
    step: "I3.geography",
    expect: "declined",
  },
  {
    utterance: "nothing really, I'm open to anything",
    lastQ: "What would you rather not see?",
    step: "I7.avoid",
    expect: "declined",
  },
  {
    utterance: "doesn't matter to me",
    lastQ: "Are there sectors to exclude outright?",
    step: "I7.sector_exclusions",
    expect: "declined",
  },
];

describe.skipIf(!LIVE || GEMINI === undefined)(
  "live: what a turn's words establish, across paraphrase",
  () => {
    it(
      "reads each case as expected",
      async () => {
        const gateway = createModelGateway({
          catalog: createStaticModelCatalog(catalog),
          registry: createModelProviderRegistry([
            createGoogleModelProvider({ apiKey: GEMINI ?? "" }),
          ]),
          usage: createInMemoryModelUsageRepository(),
        });
        const reader = createQDelegationReader({
          gateway,
          logger: createLogger(
            { serviceName: "live-eval", environment: "test" },
            { level: "silent" },
          ),
          sensitivity: "PUBLIC",
        });
        const misses: string[] = [];
        for (const c of CASES) {
          const read = await reader.read({
            utterance: c.utterance,
            lastQ: c.lastQ ?? "",
            steps: STEPS,
            pending: [],
            attribution: {
              tenantId: "c0000000-0000-4000-8000-000000000001",
              userId: "b0000000-0000-4000-8000-000000000001",
              correlationId: "cor_live_eval",
            },
          });
          const ok =
            read !== null &&
            (c.expect === "stated"
              ? read.stated.has(c.step)
              : c.expect === "not-stated"
                ? !read.stated.has(c.step) && !read.handed.has(c.step)
                : c.expect === "handed"
                  ? read.handed.has(c.step)
                  : read.declined.has(c.step));
          console.log(
            `[live] ${ok ? "ok  " : "MISS"} ${c.expect} ${c.step} <- "${c.utterance}"`,
          );
          if (!ok) misses.push(`${c.expect} ${c.step} <- "${c.utterance}"`);
        }
        expect(misses).toEqual([]);
      },
      5 * 60_000,
    );
  },
);
