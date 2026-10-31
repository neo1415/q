import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import type { RecommendationStore } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

const KENYA = countryOfIso("KE")?.nodeId ?? "";

/**
 * Typed-turn latency with fakes (owner 2026-10-16: live p50 6.3 s, max
 * 18 s; target p50 <= 3 s, max <= 8 s). Every dependency is a fake with a
 * modelled latency taken from production traces: an onboarding API round
 * trip, a direct database read, the independent reading and each model
 * round. What is measured is how the turn composes them (what waits on
 * what, and how many round trips it makes), which is what the code owns.
 * No provider is called.
 */

const SCALE = Number(process.env["CQ_BENCH_SCALE"] ?? "0.25");
const MODELLED = {
  apiRoundTripMs: 150,
  databaseMs: 40,
  readerMs: 1_500,
  toolRoundMs: 1_800,
  replyRoundMs: 1_600,
};
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms * SCALE);
  });

const logger = createLogger(
  { serviceName: "q-api-bench", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const firewall: ContextFirewallPort = {
  plan: () =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: {
        tenantId: actor.tenantId,
        actor: { userId: actor.userId },
        purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
        subjects: [],
        scopes: [
          {
            kind: "OWN_ONBOARDING",
            filter: { tenantId: actor.tenantId, userId: actor.userId },
            sensitivity: "CONFIDENTIAL",
          },
        ],
        maxSensitivity: "CONFIDENTIAL",
      } as unknown as PermittedContextPlan,
    }),
};

type Answer = {
  readonly stepKey: string;
  readonly value: string | number | readonly string[];
  readonly quote: string;
};
const TURNS: readonly {
  readonly said: string;
  readonly answers: Answer[];
  /** Answers that must NOT go on the record (refused); default none. */
  readonly refused?: number;
  /** Of those refused, saved by code from their words instead. */
  readonly savedByCode?: number;
  /**
   * What the model sends round by round (default: all answers in round
   * one). Live 2026-10-16: a fact that opens with another answer is
   * recorded a round later, and a refused one is re-sent in new words.
   */
  readonly rounds?: Answer[][];
  /** Answers kept with their notes, off the path (saved there). */
  readonly offPath?: number;
}[] = [
  {
    said: "We're seed stage, based in Kenya.",
    answers: [
      { stepKey: "F1.stage", value: "seed", quote: "seed stage" },
      { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
    ],
  },
  {
    said: "Two founders, both full time, and 14 people in total. I'm the CEO.",
    answers: [
      { stepKey: "F4.founder_count", value: 2, quote: "Two founders" },
      { stepKey: "F4.full_time", value: "all", quote: "both full time" },
      { stepKey: "F4.team_size", value: 14, quote: "14 people in total" },
      { stepKey: "F4.founder_role", value: "ceo", quote: "I'm the CEO" },
    ],
  },
  {
    said: "We have pilots running, three of them, revenue is early, and we're actively raising 2000000 US dollars.",
    answers: [
      { stepKey: "F5.signal", value: "pilots", quote: "pilots running" },
      { stepKey: "F5.pilots", value: 3, quote: "three of them" },
      {
        stepKey: "F5.revenue_status",
        value: "early",
        quote: "revenue is early",
      },
      { stepKey: "F6.raising", value: "active", quote: "actively raising" },
      { stepKey: "F6.currency", value: "usd", quote: "US dollars" },
      { stepKey: "F6.target_amount", value: 2_000_000, quote: "2000000" },
    ],
    // Revenue is off a pre-seed path here: kept with their notes.
    offPath: 1,
  },
  {
    said: "A SAFE, closing in 3 to 6 months.",
    answers: [
      { stepKey: "F6.instrument", value: "safe", quote: "A SAFE" },
      { stepKey: "F6.timeframe", value: "3_6", quote: "3 to 6 months" },
    ],
  },
  {
    said: "We describe it as remote cardiac monitoring for clinics.",
    answers: [
      {
        stepKey: "F1.description",
        value: "remote cardiac monitoring for clinics",
        quote: "remote cardiac monitoring for clinics",
      },
    ],
  },
  {
    // One answer refused (its quote is not in their words): the reply
    // needs judgement, so the model writes it in a second round.
    said: "It's quillmark.health, and we burn about forty thousand a month.",
    answers: [
      {
        stepKey: "F1.website",
        value: "quillmark.health",
        quote: "quillmark.health",
      },
      { stepKey: "F5.monthly_burn", value: 40_000, quote: "40k burn" },
    ],
    refused: 1,
    // The refused burn is saved by code from the turn's one figure.
    savedByCode: 1,
  },
  {
    // Off their path (revenue for a pre-seed company): kept with notes. The
    // live model re-sent it when it came back under another key.
    said: "We have first revenue only.",
    answers: [
      {
        stepKey: "F5.revenue_status",
        value: "early",
        quote: "first revenue only",
      },
    ],
    offPath: 1,
    rounds: [
      [
        {
          stepKey: "F5.revenue_status",
          value: "early",
          quote: "first revenue only",
        },
      ],
      [
        {
          stepKey: "F5.revenue_status",
          value: "First revenue only",
          quote: "first revenue only",
        },
      ],
    ],
  },
  {
    // A fact that opens with another answer is recorded a round later.
    said: "Our team is mostly product people, and we'd take cheques from 50k.",
    answers: [
      { stepKey: "F4.functions", value: ["product"], quote: "product people" },
      { stepKey: "F6.min_cheque", value: 50_000, quote: "50k" },
    ],
    rounds: [
      [
        {
          stepKey: "F4.functions",
          value: ["product"],
          quote: "product people",
        },
      ],
      [{ stepKey: "F6.min_cheque", value: 50_000, quote: "50k" }],
    ],
  },
  {
    // A refused answer re-sent in other words, round after round (live).
    said: "Our gross margin is decent.",
    answers: [{ stepKey: "F5.gross_margin", value: 60, quote: "60 percent" }],
    refused: 1,
    rounds: [
      [{ stepKey: "F5.gross_margin", value: 60, quote: "60 percent" }],
      [{ stepKey: "F5.gross_margin", value: 0.6, quote: "sixty" }],
      [{ stepKey: "F5.gross_margin", value: "60%", quote: "60%" }],
    ],
  },
];

type Turn = {
  readonly ms: number;
  readonly modelCalls: number;
  readonly apiCalls: number;
  readonly writes: number;
  readonly committed: number;
};

async function runBench(): Promise<Turn[]> {
  const world = investorSession({
    journey: "founder",
    currentStepKey: "F1.website",
    ineligible: ["F5.revenue_status"],
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Quillmark Health",
    },
    taxonomy: { kenya: KENYA },
  });
  let apiCalls = 0;
  let writes = 0;
  const fetchSlow: typeof fetch = async (input, init) => {
    apiCalls += 1;
    if (process.env["CQ_BENCH_TRACE"] === "1")
      console.log(
        "API",
        init?.method ?? "GET",
        (input instanceof Request ? input.url : input.toString()).replace(
          "http://api.test",
          "",
        ),
        Math.round(performance.now()),
      );
    if ((init?.method ?? "GET") === "POST") writes += 1;
    await wait(MODELLED.apiRoundTripMs);
    // The country on record is a category whose name the service gives,
    // as it does in production (read once a turn, then kept).
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes(`/taxonomy/nodes/${KENYA}`)) {
      return Response.json({
        id: KENYA,
        vocabularyCode: "geography",
        canonicalCode: "ke",
        displayName: "Kenya",
        description: null,
        parentNodeId: null,
        depth: 0,
        status: "ACTIVE",
        ancestors: [],
        aliases: [],
      });
    }
    return world.fetch(input, init);
  };
  const store = world.recommendations;
  const slowStore: RecommendationStore = {
    pending: async (...args) => {
      await wait(MODELLED.databaseMs);
      return store.pending(...args);
    },
    recommend: async (...args) => {
      await wait(MODELLED.databaseMs);
      return store.recommend(...args);
    },
  };

  let modelCalls = 0;
  let script: Answer[] = [];
  let rounds: Answer[][] = [];
  let round = 0;
  const gateway = {
    execute: async (request: { readonly tools?: readonly unknown[] }) => {
      modelCalls += 1;
      round += 1;
      const answers = rounds[round - 1];
      // The final reply call offers no tools: it is always the reply.
      if (answers !== undefined && request.tools !== undefined) {
        await wait(MODELLED.toolRoundMs);
        return {
          output: {
            kind: "TOOL_CALLS",
            calls: [
              {
                callId: `call_${String(round)}`,
                name: "record_answers",
                arguments: { answers },
              },
            ],
          },
        };
      }
      await wait(MODELLED.replyRoundMs);
      return {
        output: {
          kind: "TEXT",
          text: JSON.stringify({
            reply: "Thanks, that's on your record. What's next?",
            asking: null,
          }),
        },
      };
    },
  } as unknown as ModelGateway;
  const delegation: QDelegationReader = {
    read: async () => {
      modelCalls += 1;
      await wait(MODELLED.readerMs);
      return reading({ stated: script.map((a) => a.stepKey) });
    },
  };
  const agent = createInterviewAgent({
    gateway,
    firewall,
    logger,
    delegation,
    recommendations: slowStore,
    replyByCodeAfterCleanSave: process.env["CQ_BENCH_BEFORE"] !== "1",
  });
  const out: Turn[] = [];
  for (const t of TURNS) {
    script = t.answers;
    rounds = t.rounds ?? [t.answers];
    round = 0;
    modelCalls = 0;
    apiCalls = 0;
    writes = 0;
    const started = performance.now();
    const reply = await agent.turn({
      ...turn({ ...world, fetch: fetchSlow }, t.said),
      signup: {
        displayName: "Ines Duarte",
        organisationName: "Quillmark Health",
      },
      actor,
    });
    if (process.env["CQ_BENCH_TRACE"] === "1")
      console.log("REPLY", reply.reply);
    out.push({
      ms: Math.round((performance.now() - started) / SCALE),
      modelCalls,
      apiCalls,
      writes,
      committed:
        (t.offPath ?? 0) +
        t.answers.filter((a) => world.recordedValue(a.stepKey) !== undefined)
          .length,
    });
  }
  return out;
}

describe("typed interview turn latency, with fakes", () => {
  it("meets p50 <= 3 s and max <= 8 s, every answer on the record", async () => {
    const turns = await runBench();
    const sorted = turns.map((t) => t.ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const max = sorted.at(-1) ?? 0;
    console.log(
      JSON.stringify({ scale: SCALE, modelled: MODELLED, p50, max, turns }),
    );
    for (const [index, t] of turns.entries()) {
      const spec = TURNS[index];
      expect(t.committed, `turn ${String(index + 1)}`).toBe(
        (spec?.answers.length ?? 0) -
          (spec?.refused ?? 0) +
          (spec?.savedByCode ?? 0),
      );
    }
    // What the code owns, asserted always: a clean save is one model round
    // plus the parallel reading, and one write for the whole breath.
    for (const [index, t] of turns.entries()) {
      const spec = TURNS[index];
      const single = (spec?.rounds?.length ?? 1) === 1;
      const clean = (spec?.refused ?? 0) === 0 && single;
      // A clean save is one model round plus the reading; anything else at
      // most one more round and the reply.
      expect(t.modelCalls, `turn ${String(index + 1)}`).toBeLessThanOrEqual(
        clean ? 2 : 3,
      );
      expect(t.apiCalls, `turn ${String(index + 1)}`).toBeLessThanOrEqual(
        // A fact kept with their notes is one more write. One more for
        // their words, kept on the thread before the model runs (a write
        // beside the turn's first reads, not a wait of its own).
        // And from turn 2, one read of the name of the country saved in
        // turn 1: a category, never their words (live 2026-10-31).
        (single ? 6 + (spec?.offPath ?? 0) + (spec?.savedByCode ?? 0) : 9) +
          (index > 0 ? 1 : 0),
      );
    }
    // Wall-clock targets only when benchmarking on purpose: timers on a
    // loaded CI runner are not the code's latency (no flaky gates).
    if (process.env["CQ_BENCH"] === "1") {
      expect(p50).toBeLessThanOrEqual(3_000);
      expect(max).toBeLessThanOrEqual(8_000);
    }
  }, 120_000);
});
