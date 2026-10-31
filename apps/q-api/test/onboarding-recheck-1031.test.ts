import { describe, expect, it } from "vitest";

import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import {
  createOnboardingTranscriptReader,
  type OnboardingTranscriptReader,
  type QDelegationReader,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { NOT_KNOWN_TEXT } from "../src/voice/onboarding-port.js";
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live re-check 2026-10-31 (production 91b19d615, fictional investor r1 and
 * founder r2, typed). No live model: the readers and the reply are fakes
 * that answer as the live ones did.
 *
 * 1. "We write cheques of EUR 750k to 3 million" was read as "actively
 *    investing" before Q asked and saved; "I don't know honestly, the
 *    partners haven't decided" later replaced it as the step's text.
 * 2. One "yes" to Q's summary, after the read-back, also finished setup.
 * 3. Q asked which currency although "1.5 million euros" had been said;
 *    it was saved two seconds after the question.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000001",
};
const SESSION = "11111111-1111-4111-8111-111111111111";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "investor" },
};

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;
const scripted = (readings: Reading[]): OnboardingTranscriptReader => ({
  read: () =>
    Promise.resolve(
      readings.length > 1 ? (readings.shift() ?? null) : (readings[0] ?? null),
    ),
});

const CHEQUES =
  "We're a venture capital fund. We write cheques of EUR 750k to 3 million into seed and Series A companies.";
const DONT_KNOW = "I don't know honestly, the partners haven't decided.";
const PACE_Q =
  "What's the current deployment pace: actively investing, selective, paused, or exploring only?";

describe("1. only what the person stated is saved; Q's inference waits for their yes", () => {
  it("an inferred deployment status is held as a suggestion, never written; their stated cheque is saved", async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      subject: FIRM,
      recorded: { "I0.investor_type": "vc" },
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: scripted([
        {
          answers: [
            {
              stepKey: "I1.deployment_status",
              value: "actively_investing",
              quote: "We write cheques of EUR 750k to 3 million",
              ownWords: false,
              source: "INFERRED",
            },
            {
              stepKey: "I2.cheque_min",
              value: 750000,
              quote: "We write cheques of EUR 750k to 3 million",
              ownWords: false,
              source: "STATED",
            },
          ],
          declined: [],
          notKnown: [],
        },
      ]),
    });
    await conversation.said?.(line, "PERSON", CHEQUES);
    await conversation.flush?.(line);
    expect(world.recordedValue("I1.deployment_status")).toBeUndefined();
    expect(world.heldSuggestions()).toEqual([
      expect.objectContaining({
        stepKey: "I1.deployment_status",
        value: { type: "SINGLE_SELECT", optionKey: "actively_investing" },
        status: "PENDING",
      }),
    ]);
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "750000",
    });
  });

  it('"I don\'t know" to a needed step records it as not known, never their sentence and never a value; it stays answerable', async () => {
    const world = investorSession({
      currentStepKey: "I1.deployment_status",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc" },
    });
    const readings: Reading[] = [
      {
        // The live reading gave both: their sentence as own words, and
        // (v9) that they do not know. Not knowing wins; no value.
        answers: [
          {
            stepKey: "I1.deployment_status",
            value: DONT_KNOW,
            quote: DONT_KNOW,
            ownWords: true,
            source: "STATED",
          },
        ],
        declined: [],
        notKnown: [{ stepKey: "I1.deployment_status", quote: DONT_KNOW }],
      },
    ];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: scripted(readings),
    });
    await conversation.said?.(line, "Q", PACE_Q, "I1.deployment_status");
    await conversation.said?.(line, "PERSON", DONT_KNOW);
    await conversation.flush?.(line);
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "TEXT",
      text: NOT_KNOWN_TEXT,
    });

    // Answerable later: Q asks again, and their answer replaces it.
    readings.splice(0, readings.length, {
      answers: [
        {
          stepKey: "I1.deployment_status",
          value: "actively_investing",
          quote: "We're actively investing now",
          ownWords: false,
          aboutStep: true,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await conversation.said?.(line, "Q", PACE_Q, "I1.deployment_status");
    await conversation.said?.(line, "PERSON", "We're actively investing now");
    await conversation.flush?.(line);
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });

  it("not knowing an optional step sets it aside", async () => {
    const world = investorSession({
      currentStepKey: "I0.business_title",
      subject: FIRM,
      recorded: { "I0.investor_type": "vc" },
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: scripted([
        {
          answers: [],
          declined: [],
          notKnown: [{ stepKey: "I0.business_title", quote: "not sure yet" }],
        },
      ]),
    });
    await conversation.said?.(line, "PERSON", "not sure yet");
    await conversation.flush?.(line);
    expect(world.recordedValue("I0.business_title")).toBeUndefined();
    expect(world.skippedSteps()).toContain("I0.business_title");
  });

  it("the model reader's reading must say, per value, stated or inferred: one that does not is not used", async () => {
    const value = {
      answers: [
        {
          stepKey: "I1.deployment_status",
          value: "o1",
          quote: "We write cheques",
          ownWords: false,
          replaces: false,
          aboutStep: false,
        },
      ],
      declined: [],
      notKnown: [],
    };
    const gateway = {
      execute: () => Promise.resolve({ output: { kind: "STRUCTURED", value } }),
    } as unknown as ModelGateway;
    const reader = createOnboardingTranscriptReader({ gateway, logger });
    const input = {
      journey: "investor" as const,
      steps: [
        {
          stepKey: "I1.deployment_status",
          question: "Are you deploying capital right now?",
          kind: "ONE_OF",
          required: true,
          options: "o1: Actively investing",
          onRecord: "nothing",
        },
      ],
      turns: [{ role: "PERSON" as const, text: "We write cheques" }],
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        correlationId: "cor_test",
      },
    };
    expect(await reader.read(input)).toBeNull();
    value.answers[0] = { ...value.answers[0], source: "INFERRED" } as never;
    expect((await reader.read(input))?.answers[0]?.source).toBe("INFERRED");
  });
});

/** Every required non-review step answered. */
function everyEssential(
  except: readonly string[] = [],
): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const step of INVESTOR_DEFINITION_V1.steps) {
    if (!step.required || except.includes(step.stepKey)) continue;
    const c = step.configuration;
    if (c.stepType === "confirmation") continue;
    recorded[step.stepKey] =
      c.stepType === "single_select" || c.stepType === "multi_select"
        ? (c.options[0]?.optionKey ?? "")
        : c.stepType === "reference_select"
          ? "d0000000-0000-4000-8000-000000000001"
          : c.stepType === "range"
            ? "10"
            : "Ajali Health";
  }
  return recorded;
}

type Reply = { reply: string; asking?: string | null };
function replies(script: readonly Reply[]) {
  const seen: string[] = [];
  let index = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      const next = script[Math.min(index, script.length - 1)];
      index += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            reply: next?.reply ?? "",
            asking: next?.asking ?? null,
            readBack: false,
          },
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

function typed(options: {
  readonly world: ReturnType<typeof investorSession>;
  readonly delegation: QDelegationReader;
  readonly script: readonly Reply[];
  readonly readings?: Reading[];
}) {
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: options.world.fetch,
    logger,
    readAfterMs: 5,
    recommendations: options.world.recommendations,
    reader: scripted(
      options.readings ?? [{ answers: [], declined: [], notKnown: [] }],
    ),
  });
  const { gateway, seen } = replies(options.script);
  const path = createTypedOnboarding({
    conversation,
    gateway,
    delegation: options.delegation,
    recommendations: options.world.recommendations,
    logger,
  });
  const say = async (words: string) => {
    const outcome = await path.turn({ ...turn(options.world, words), actor });
    if (outcome === null) throw new Error("the typed path declined the turn");
    return outcome;
  };
  return { say, seen };
}

describe("2. a reply binds to the one thing Q just asked", () => {
  it("after the read-back, a yes to Q's next question is that question's, never the finish", async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(),
    });
    const asked: (string | null | undefined)[] = [];
    let calls = 0;
    // As the live reading: their words agree to whatever Q asked; the
    // first asks to finish, the second declines the read-back for now.
    const delegation: QDelegationReader = {
      read: (input) => {
        asked.push(input.askedStep);
        calls += 1;
        if (calls === 1) return Promise.resolve(reading({ finishing: true }));
        if (calls === 2) return Promise.resolve(reading({}));
        return Promise.resolve(
          reading({
            stated:
              input.askedStep === undefined || input.askedStep === null
                ? []
                : [input.askedStep],
          }),
        );
      },
    };
    const { say } = typed({
      world,
      delegation,
      script: [
        {
          reply:
            "Your thesis: the grid in northern Europe is rebuilt over fifteen years. Is that right?",
          asking: "I6.custom_criteria",
        },
      ],
    });
    const readBack = await say("that's all");
    expect(readBack.reply).toMatch(/Say yes and I'll finish/u);
    await say("Not finished yet. Let's go through the other details first.");
    const yes = await say("yes");
    expect(yes.view.session.status).not.toBe("COMPLETED");
    expect(world.recordedValue("I11.review")).toBeUndefined();
    // The yes was read against Q's question, not the read-back.
    expect(asked[2]).toBe("I6.custom_criteria");
  });

  it("finishing lists the suggestions still waiting on their yes in the read-back", async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      subject: FIRM,
      recorded: everyEssential(),
    });
    await world.recommendations.recommend({
      userId: actor.userId,
      sessionId: SESSION,
      stepKey: "I0.business_title",
      value: { type: "TEXT", text: "Managing partner" },
      rationale: 'From what you said earlier: "I\'m a managing partner"',
      runId: null,
    });
    const { say } = typed({
      world,
      delegation: { read: () => Promise.resolve(reading({ finishing: true })) },
      script: [{ reply: "unused" }],
    });
    const readBack = await say("that's all");
    expect(readBack.reply).toMatch(/Not saved, waiting for your yes/u);
    expect(readBack.reply).toMatch(/Managing partner/u);
    expect(readBack.view.session.status).not.toBe("COMPLETED");
  });
});

describe("3. Q's next question is chosen after what they said is read", () => {
  it("a question about something the reading just saved is written again from the record", async () => {
    const world = investorSession({
      currentStepKey: "I2.currency",
      subject: FIRM,
      recorded: everyEssential(["I2.currency"]),
    });
    const { say, seen } = typed({
      world,
      delegation: { read: () => Promise.resolve(reading({})) },
      script: [
        { reply: "Which currency do you invest in?", asking: "I2.currency" },
        { reply: "Which sectors do you focus on?", asking: "I3.sectors" },
      ],
      readings: [
        {
          answers: [
            {
              stepKey: "I2.currency",
              value: "eur",
              quote: "1.5 million euros",
              ownWords: false,
              source: "STATED",
            },
          ],
          declined: [],
          notKnown: [],
        },
      ],
    });
    const outcome = await say("Typically 1.5 million euros a cheque");
    expect(world.recordedValue("I2.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "eur",
    });
    expect(outcome.reply).toBe("Which sectors do you focus on?");
    expect(seen).toHaveLength(2);
    // The second reply saw the currency saved.
    expect(seen[1]).toMatch(/already saved: [^\]]*Euro/iu);
  });
});
