import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import type { InvestorResearch } from "../src/voice/investor-research.js";
import type { RecommendationStore } from "../src/voice/onboarding-port.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Every onboarding journey, timed end to end (owner 2026-10-21: as fast as
 * it can be done properly; something visible at once, Q's first words
 * early, real stages shown while work that matters takes longer).
 *
 * The real interview agent, onboarding port, tools, reply guards and code
 * paths run; only what is outside q-api is a fake with a recorded latency:
 *
 *   - onboarding API round trip 150 ms and a direct database read 40 ms;
 *   - the independent reading (DELEGATION_READER) 1.5 s;
 *   - a model tool round 1.8 s and a model reply round 1.6 s;
 *   - a streamed reply's first token 700 ms after the call;
 *   - text-to-speech first audio 300 ms after a sentence (voice only).
 *
 * Source: the production traces recorded in interview-latency.bench.test.ts
 * (owner 2026-10-16 live p50 6.3 s; hosted rounds ~2 s, 2026-09-30), and the
 * provider's published first-token and first-audio figures. No provider is
 * called. The timings are reported, not gated; with CQ_BENCH=1 the first
 * visible stage is asserted. The model-call counts always are.
 */

const SCALE = Number(process.env["CQ_BENCH_SCALE"] ?? "0.25");
const MODELLED = {
  apiRoundTripMs: 150,
  databaseMs: 40,
  readerMs: 1_500,
  toolRoundMs: 1_800,
  replyRoundMs: 1_600,
  firstTokenMs: 700,
  ttsFirstAudioMs: 300,
} as const;
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
/** One model call: a tool round recording these answers, or a reply. */
type Call =
  | { readonly record: readonly Answer[] }
  | { readonly reply: string; readonly asking?: string | null };

type Journey = {
  readonly name: string;
  readonly said: string;
  readonly channel?: "text" | "voice";
  /** What the model does, call by call; the last is repeated. */
  readonly calls: readonly Call[];
  /** Steps the independent reading finds stated. */
  readonly stated?: readonly string[];
  /** A turn first, untimed, so Q has asked this step. */
  readonly askedFirst?: string;
};

const REPLY = "Thanks, that's on your record. Who are your customers?";

const JOURNEYS: readonly Journey[] = [
  {
    name: "opening / resume",
    said: "",
    calls: [
      {
        reply: "Welcome back. What stage is Quillmark at?",
        asking: "F1.stage",
      },
    ],
  },
  {
    name: "typed exact answer (Seed.)",
    said: "Seed.",
    askedFirst: "F1.stage",
    calls: [{ reply: REPLY }],
  },
  {
    name: "typed answer, clean save",
    said: "We're seed stage, based in Kenya.",
    stated: ["F1.stage", "F1.country"],
    calls: [
      {
        record: [
          { stepKey: "F1.stage", value: "seed", quote: "seed stage" },
          { stepKey: "F1.country", value: "ke", quote: "based in Kenya" },
        ],
      },
      { reply: REPLY },
    ],
  },
  {
    name: "typed answer needing Q's judgement",
    said: "Two founders, and our gross margin is decent.",
    stated: ["F4.founder_count"],
    calls: [
      {
        record: [
          { stepKey: "F4.founder_count", value: 2, quote: "Two founders" },
          { stepKey: "F5.gross_margin", value: 60, quote: "60 percent" },
        ],
      },
      { reply: "Two founders, saved. What is your gross margin, roughly?" },
    ],
  },
  {
    name: "typed answer, refused and re-sent (worst case)",
    said: "Our gross margin is decent.",
    calls: [
      {
        record: [
          { stepKey: "F5.gross_margin", value: 60, quote: "60 percent" },
        ],
      },
      { record: [{ stepKey: "F5.gross_margin", value: 0.6, quote: "sixty" }] },
      { record: [{ stepKey: "F5.gross_margin", value: "60%", quote: "60%" }] },
      { reply: "What is your gross margin, roughly, as a percentage?" },
    ],
  },
  {
    name: "spoken answer, clean save",
    said: "We're seed stage, based in Kenya.",
    channel: "voice",
    stated: ["F1.stage", "F1.country"],
    calls: [
      {
        record: [
          { stepKey: "F1.stage", value: "seed", quote: "seed stage" },
          { stepKey: "F1.country", value: "ke", quote: "based in Kenya" },
        ],
      },
      { reply: REPLY },
    ],
  },
  {
    name: "answer naming the company (research by name)",
    said: "It's quillmark.health.",
    stated: ["F1.website"],
    calls: [
      {
        record: [
          {
            stepKey: "F1.website",
            value: "quillmark.health",
            quote: "quillmark.health",
          },
        ],
      },
      { reply: REPLY },
    ],
  },
];

type Timing = {
  readonly journey: string;
  readonly firstVisibleMs: number | null;
  readonly firstWordsMs: number | null;
  readonly completeMs: number;
  readonly modelCalls: number;
};

async function runJourney(journey: Journey): Promise<Timing> {
  const world = investorSession({
    journey: "founder",
    currentStepKey: "F1.website",
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Quillmark Health",
    },
  });
  const fetchSlow: typeof fetch = async (input, init) => {
    await wait(MODELLED.apiRoundTripMs);
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
  let script: readonly Call[] = [];
  let at = 0;
  const gateway = {
    execute: async (
      request: { readonly tools?: readonly unknown[] },
      options?: {
        readonly onTextDelta?: (text: string) => void;
        readonly schema?: { readonly parse: (value: unknown) => unknown };
      },
    ) => {
      modelCalls += 1;
      const call = script[Math.min(at, script.length - 1)];
      at += 1;
      if (
        call !== undefined &&
        "record" in call &&
        request.tools !== undefined
      ) {
        await wait(MODELLED.toolRoundMs);
        return {
          output: {
            kind: "TOOL_CALLS",
            calls: [
              {
                callId: `call_${String(at)}`,
                name: "record_answers",
                arguments: { answers: call.record },
              },
            ],
          },
        };
      }
      const reply =
        call !== undefined && "reply" in call
          ? call
          : { reply: REPLY, asking: null };
      const text = JSON.stringify({
        reply: reply.reply,
        asking: reply.asking ?? null,
      });
      if (options?.onTextDelta !== undefined) {
        // Streamed: the first token, then the rest in even pieces.
        await wait(MODELLED.firstTokenMs);
        const pieces = 8;
        const size = Math.ceil(text.length / pieces);
        for (let i = 0; i < text.length; i += size) {
          options.onTextDelta(text.slice(i, i + size));
          await wait((MODELLED.replyRoundMs - MODELLED.firstTokenMs) / pieces);
        }
      } else {
        await wait(MODELLED.replyRoundMs);
      }
      const structured = request.tools === undefined;
      return structured
        ? {
            output: {
              kind: "STRUCTURED",
              value:
                options?.schema === undefined
                  ? (JSON.parse(text) as unknown)
                  : options.schema.parse(JSON.parse(text)),
            },
          }
        : { output: { kind: "TEXT", text } };
    },
  } as unknown as ModelGateway;
  let stated: readonly string[] = [];
  const delegation: QDelegationReader = {
    read: async () => {
      modelCalls += 1;
      await wait(MODELLED.readerMs);
      return reading({ stated: [...stated] });
    },
  };
  // Research by name: started, never waited on (it reads the web for
  // seconds); the turn only reports that it started.
  const research: InvestorResearch = {
    consider: () => true,
    offerReady: () => Promise.resolve(0),
    status: () => "IDLE" as never,
    unsaid: () => new Set(),
    markSaid: () => undefined,
    takeNote: () => null,
  };
  const agent = createInterviewAgent({
    gateway,
    firewall,
    logger,
    delegation,
    recommendations: slowStore,
    replyByCodeAfterCleanSave: true,
    readingByCodeWhereExact: true,
    ...(journey.name.includes("research") ? { founderResearch: research } : {}),
  });

  if (journey.askedFirst !== undefined) {
    script = [
      { reply: "What stage is Quillmark at?", asking: journey.askedFirst },
    ];
    at = 0;
    await agent.turn({
      ...turn({ ...world, fetch: fetchSlow }, "Hi, where do we start?"),
      actor,
    });
  }

  script = journey.calls;
  at = 0;
  stated = journey.stated ?? [];
  modelCalls = 0;
  const started = performance.now();
  const since = () => Math.round((performance.now() - started) / SCALE);
  let firstStage: number | null = null;
  let firstSentence: number | null = null;
  const input = {
    ...turn({ ...world, fetch: fetchSlow }, journey.said),
    ...(journey.channel === undefined ? {} : { channel: journey.channel }),
    signup: {
      displayName: "Ines Duarte",
      organisationName: "Quillmark Health",
    },
    actor,
    onSentence: () => {
      firstSentence ??= since();
    },
    onStage: () => {
      firstStage ??= since();
    },
  };
  await agent.turn(input);
  const completeMs = since();
  const voice = journey.channel === "voice" ? MODELLED.ttsFirstAudioMs : 0;
  const words = firstSentence ?? completeMs;
  return {
    journey: journey.name,
    firstVisibleMs: firstStage ?? firstSentence,
    firstWordsMs: words + voice,
    completeMs,
    modelCalls,
  };
}

describe("every onboarding journey, timed end to end", () => {
  it("times each journey: first visible, first words, complete, model calls", async () => {
    const timings: Timing[] = [];
    for (const journey of JOURNEYS) timings.push(await runJourney(journey));
    console.log(
      JSON.stringify({ scale: SCALE, modelled: MODELLED, timings }, null, 1),
    );
    for (const t of timings) {
      // What the code owns, always: at most one tool round and one reply
      // beside the reading, and none for an exact answer.
      expect(t.modelCalls, t.journey).toBeLessThanOrEqual(
        t.journey.includes("exact") ? 0 : 4,
      );
    }
    // The timings are evidence, not a gate (owner 2026-10-21: as fast as it
    // can be done properly, never by cutting real work). What is held:
    // something is visible at once, from the turn's own first event.
    if (process.env["CQ_BENCH"] === "1") {
      for (const t of timings) {
        expect(t.firstVisibleMs ?? Infinity, t.journey).toBeLessThanOrEqual(
          1_000,
        );
      }
    }
  }, 180_000);
});
