import { describe, expect, it, vi } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QDelegationReader,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  createOnboardingConversation,
  withoutAgreeingWords,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import {
  ALREADY_ANSWERED_LINE,
  createTypedOnboarding,
  followUpIfAnswered,
} from "../src/voice/typed-onboarding.js";

import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live final re-check 2026-10-31 (production 68ab54317, fictional founder
 * "Fjordlys" and investor "Wadden Polder", typed). No live model: readers
 * and replies are fakes answering as the live ones did.
 *
 * 1. Typed replies waited for the reading (commit 323789973): median 12.4 s.
 * 2. "Raising 1.5 million euros" saved only "raising"; Q asked the currency.
 * 3. "We write cheques…" saved "actively investing", never asked.
 * 4. "Yes, please." to Q's offer saved as the deployment status's text.
 * 5. Pilots set aside unasked-for; "; yes" in a note; "Agriculture region".
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
const COMPANY = {
  type: "COMPANY" as const,
  id: "e0000000-0000-4000-8000-0000000000aa",
};
const SESSION = "11111111-1111-4111-8111-111111111111";
const lineOf = (journeyType: "investor" | "founder"): ConversationLine => ({
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType },
});

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;
type ReaderInput = Parameters<OnboardingTranscriptReader["read"]>[0];
const EMPTY: NonNullable<Reading> = { answers: [], declined: [], notKnown: [] };

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The option id a reader sees for an option key of a step (o1, o2...). */
function idOf(input: ReaderInput, stepKey: string, label: string): string {
  const options = input.steps.find((s) => s.stepKey === stepKey)?.options;
  const found = (options ?? "")
    .split("; ")
    .find((pair) => pair.endsWith(`: ${label}`));
  if (found === undefined) throw new Error(`no option ${label}`);
  return found.split(":")[0] ?? "";
}

describe("1. Q's reply never waits for the reading of their words", () => {
  const REPLY_MS = 150;
  const READING_MS = 1_200;

  function slowWorld() {
    const world = investorSession({
      currentStepKey: "I2.currency",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc", "I0.organisation_name": "Polder" },
    });
    let readEnded = 0;
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: async () => {
          await sleep(READING_MS);
          readEnded = Date.now();
          return {
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
          };
        },
      },
    });
    const gateway = {
      execute: async () => {
        await sleep(REPLY_MS);
        return {
          output: {
            kind: "STRUCTURED",
            value: {
              // As the live reply did: it asks what the words answered.
              reply: "Thanks. Which currency do you write cheques in?",
              asking: "I2.currency",
              readBack: false,
            },
          },
        };
      },
    } as unknown as ModelGateway;
    const delegation: QDelegationReader = {
      read: async () => {
        await sleep(REPLY_MS);
        return reading({});
      },
    };
    const path = createTypedOnboarding({
      conversation,
      gateway,
      delegation,
      logger,
    });
    return { world, path, readEnded: () => readEnded };
  }

  it("answers in the reply's time, and follows up once the reading shows the question was answered", async () => {
    const { world, path, readEnded } = slowWorld();
    const started = Date.now();
    const outcome = await path.turn({
      ...turn(world, "Typically 1.5 million euros a cheque"),
      actor,
    });
    const turnMs = Date.now() - started;
    // Before (323789973): the reply waited for the reading, then wrote
    // the reply again: >= READING_MS + REPLY_MS. Now: the reply's time.
    expect(turnMs).toBeLessThan(READING_MS);
    expect(outcome?.reply).toBe(
      "Thanks. Which currency do you write cheques in?",
    );
    // The reading lands after the reply; Q follows up, kept in the thread
    // with the next step, never leaving the stale question as its last line.
    await vi.waitFor(
      () => {
        expect(world.thread().at(-1)?.text).toMatch(
          new RegExp(`^${ALREADY_ANSWERED_LINE}`, "u"),
        );
      },
      { timeout: 4_000, interval: 20 },
    );
    expect(readEnded()).toBeGreaterThan(started + turnMs);
    expect(world.recordedValue("I2.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "eur",
    });
    expect(world.keptSteps().at(-1)).not.toBe("I2.currency");
    expect(world.thread().at(-2)?.text).toBe(
      "Thanks. Which currency do you write cheques in?",
    );
    // Recorded for the report: the fake timings, before and after.
    console.info(
      `typed turn: ${String(turnMs)} ms with a ${String(REPLY_MS)} ms reply and a ${String(READING_MS)} ms reading (blocking wait would be >= ${String(READING_MS + REPLY_MS)} ms)`,
    );
  });

  it("no follow-up once they said something after the reply, or when the step is still open", async () => {
    const said: string[] = [];
    const state = (status: "OPEN" | "ANSWERED") =>
      Promise.resolve({
        journey: "investor" as const,
        currentStepKey: null,
        canComplete: false,
        completed: false,
        steps: [
          {
            stepKey: "I2.currency",
            question: "Which currency?",
            kind: "ONE_OF" as const,
            required: true,
            status,
            value: null,
          },
        ],
        checks: [],
        next: [],
      });
    const say = (line: { readonly text: string }) => {
      said.push(line.text);
      return Promise.resolve();
    };
    expect(
      await followUpIfAnswered({
        asked: "I2.currency",
        stillLast: () => false,
        state: () => state("ANSWERED"),
        say,
      }),
    ).toBe(false);
    expect(
      await followUpIfAnswered({
        asked: "I2.currency",
        stillLast: () => true,
        state: () => state("OPEN"),
        say,
      }),
    ).toBe(false);
    expect(said).toEqual([]);
    expect(
      await followUpIfAnswered({
        asked: "I2.currency",
        stillLast: () => true,
        state: () => state("ANSWERED"),
        say,
      }),
    ).toBe(true);
    expect(said).toEqual([ALREADY_ANSWERED_LINE]);
  });
});

describe("2. every step the turn's words answer is written, even one their answer opens", () => {
  it('"raising 1.5 million euros": the amount and currency open once raising is saved, and the same words are read again', async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.raising",
      subject: COMPANY,
      servesTurnSteps: true,
      opensAfter: {
        "F6.currency": "F6.raising",
        "F6.target_amount": "F6.raising",
      },
      listsOnlyOpened: true,
    });
    const seen: string[][] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        // As a reader does: it can give only the steps it is shown.
        read: (input) => {
          const keys = input.steps.map((s) => s.stepKey);
          seen.push(keys);
          const quote = "We are raising 1.5 million euros";
          const answers: NonNullable<Reading>["answers"][number][] = [
            {
              stepKey: "F6.raising",
              value: idOf(input, "F6.raising", "Yes, actively"),
              quote,
              ownWords: false,
              source: "STATED",
            },
          ];
          if (keys.includes("F6.currency")) {
            answers.push(
              {
                stepKey: "F6.target_amount",
                value: 1_500_000,
                quote,
                ownWords: false,
                source: "STATED",
              },
              {
                stepKey: "F6.currency",
                value: idOf(input, "F6.currency", "Euro"),
                quote,
                ownWords: false,
                source: "STATED",
              },
            );
          }
          return Promise.resolve({ answers, declined: [], notKnown: [] });
        },
      },
    });
    const line = lineOf("founder");
    await conversation.said?.(
      line,
      "Q",
      "Are you raising right now?",
      "F6.raising",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "Yes, actively. We are raising 1.5 million euros.",
    );
    await conversation.flush?.(line);
    expect(seen[0]).not.toContain("F6.currency");
    expect(seen[1]).toContain("F6.currency");
    expect(world.recordedValue("F6.raising")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "active",
    });
    expect(world.recordedValue("F6.target_amount")).toEqual({
      type: "RANGE",
      value: "1500000",
    });
    expect(world.recordedValue("F6.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "eur",
    });
  });
});

describe("3. a judgement about their current state is never read in unasked", () => {
  it('"we write cheques…" labelled STATED is held for their yes; their answer to Q\'s question saves it', async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: { "I0.investor_type": "vc" },
    });
    const readings: Reading[] = [];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      recommendations: world.recommendations,
      reader: {
        read: () => Promise.resolve(readings.shift() ?? EMPTY),
      },
    });
    const line = lineOf("investor");
    const CHEQUES =
      "We're a venture capital fund. We write cheques of EUR 750k to 3 million.";
    readings.push({
      answers: [
        {
          // The live reading called it STATED.
          stepKey: "I1.deployment_status",
          value: "actively_investing",
          quote: "We write cheques of EUR 750k to 3 million",
          ownWords: false,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await conversation.said?.(
      line,
      "Q",
      "How do you invest?",
      "I0.investor_type",
    );
    await conversation.said?.(line, "PERSON", CHEQUES);
    await conversation.flush?.(line);
    expect(world.recordedValue("I1.deployment_status")).toBeUndefined();
    expect(world.heldSuggestions()).toEqual([
      expect.objectContaining({
        stepKey: "I1.deployment_status",
        status: "PENDING",
      }),
    ]);

    readings.push({
      answers: [
        {
          stepKey: "I1.deployment_status",
          value: "actively_investing",
          quote: "Yes, actively investing",
          ownWords: false,
          aboutStep: true,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await conversation.said?.(
      line,
      "Q",
      "Are you deploying capital right now?",
      "I1.deployment_status",
    );
    await conversation.said?.(line, "PERSON", "Yes, actively investing");
    await conversation.flush?.(line);
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });
});

describe("4. a yes to Q's offer writes the offered value, never the word yes", () => {
  const OFFER =
    "Thanks for flagging that — should I change your current deployment status from actively investing to undecided for now?";

  function world() {
    return investorSession({
      currentStepKey: "I1.deployment_status",
      subject: FIRM,
      servesTurnSteps: true,
      recorded: {
        "I0.investor_type": "vc",
        "I1.deployment_status": "actively_investing",
      },
    });
  }

  it('"Yes, please." read as their own words for the step saves nothing', async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: () =>
          Promise.resolve({
            answers: [
              {
                stepKey: "I1.deployment_status",
                value: "Yes, please.",
                quote: "Yes, please.",
                ownWords: true,
                aboutStep: true,
                source: "STATED",
                affirms: true,
              },
            ],
            declined: [],
            notKnown: [],
          }),
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "Q", OFFER, "I1.deployment_status");
    await conversation.said?.(line, "PERSON", "Yes, please.");
    await conversation.flush?.(line);
    expect(w.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });

  it("an offered value that names no option is never kept as their words", async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: () =>
          Promise.resolve({
            answers: [
              {
                stepKey: "I1.deployment_status",
                value: "undecided",
                quote: "Yes, please.",
                ownWords: true,
                aboutStep: true,
                source: "STATED",
                affirms: true,
              },
            ],
            declined: [],
            notKnown: [],
          }),
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "Q", OFFER, "I1.deployment_status");
    await conversation.said?.(line, "PERSON", "Yes, please.");
    await conversation.flush?.(line);
    expect(w.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });

  it('the yes is "Not sure yet" (investor v3) when that is what Q offered', async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: (input) =>
          Promise.resolve({
            answers: [
              {
                stepKey: "I1.deployment_status",
                value: idOf(input, "I1.deployment_status", "Not sure yet"),
                quote: "Yes, please.",
                ownWords: false,
                aboutStep: true,
                source: "STATED",
                affirms: true,
              },
            ],
            declined: [],
            notKnown: [],
          }),
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(line, "Q", OFFER, "I1.deployment_status");
    await conversation.said?.(line, "PERSON", "Yes, please.");
    await conversation.flush?.(line);
    expect(w.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "not_sure",
    });
  });

  it('"I don\'t know" to the needed step is its "Not sure yet" option, never words', async () => {
    const w = world();
    const DONT_KNOW =
      "On whether we are deploying capital right now, I don't know honestly, the partners haven't decided.";
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: () =>
          Promise.resolve({
            answers: [],
            declined: [],
            notKnown: [
              {
                stepKey: "I1.deployment_status",
                quote: DONT_KNOW,
                saidSo: true,
              },
            ],
          }),
      },
    });
    const line = lineOf("investor");
    await conversation.said?.(
      line,
      "Q",
      "Are you deploying capital right now?",
      "I1.deployment_status",
    );
    await conversation.said?.(line, "PERSON", DONT_KNOW);
    await conversation.flush?.(line);
    expect(w.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "not_sure",
    });
  });

  it("agreeing words are dropped from any answer; an option or Q's words stay", () => {
    const isOption = (_step: string, value: string) => value === "not_sure";
    const base = {
      stepKey: "F1.categories",
      quote: "yes",
      ownWords: false,
      affirms: true,
    };
    expect(
      withoutAgreeingWords({ ...base, value: ["Agriculture", "yes"] }, isOption)
        ?.value,
    ).toEqual(["Agriculture"]);
    expect(
      withoutAgreeingWords({ ...base, value: "yes" }, isOption),
    ).toBeNull();
    expect(
      withoutAgreeingWords(
        { ...base, quote: "Yes, not sure", value: "not_sure" },
        isOption,
      )?.value,
    ).toBe("not_sure");
    // Not an agreement: their words are their answer.
    expect(
      withoutAgreeingWords({ ...base, affirms: false, value: "yes" }, isOption)
        ?.value,
    ).toBe("yes");
  });
});

describe("5. minor: nothing set aside unasked-for; notes say only what was read", () => {
  it("an optional step they did not answer is not set aside (saidSo false), nor a needed one recorded as not known", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F5.pilots",
      subject: COMPANY,
      servesTurnSteps: true,
      recorded: { "F5.signal": "pilots" },
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader: {
        read: () =>
          Promise.resolve({
            answers: [],
            declined: [
              {
                stepKey: "F5.pilots",
                quote: "We report in euros",
                saidSo: false,
              },
            ],
            notKnown: [
              {
                stepKey: "F6.raising",
                quote: "We report in euros",
                saidSo: false,
              },
            ],
          }),
      },
    });
    const line = lineOf("founder");
    await conversation.said?.(
      line,
      "Q",
      "How many pilots or design partners are you working with, and what currency do you use for your financial figures?",
      "F5.pilots",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "We report in euros, burn about 45k a month.",
    );
    await conversation.flush?.(line);
    expect(world.skippedSteps()).not.toContain("F5.pilots");
    expect(world.recordedValue("F6.raising")).toBeUndefined();
  });

  it('a yes to a say-back adds no "; yes" to the categories\' note, and an industry is never a "region"', async () => {
    const AGRICULTURE = "a2000000-0000-4000-8000-000000000001";
    const GRAIN = "a2000000-0000-4000-8000-000000000002";
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.categories",
      subject: COMPANY,
      servesTurnSteps: true,
      taxonomyNodes: [
        {
          id: AGRICULTURE,
          canonicalCode: "agriculture",
          displayName: "Agriculture",
          parentNodeId: null,
          depth: 0,
        },
        {
          id: GRAIN,
          canonicalCode: "grain_storage",
          displayName: "Grain storage",
          parentNodeId: AGRICULTURE,
          depth: 1,
        },
      ],
    });
    const readings: Reading[] = [
      {
        answers: [
          {
            stepKey: "F1.categories",
            value: ["grain-storage analytics"],
            quote: "grain-storage analytics",
            ownWords: false,
            source: "STATED",
          },
        ],
        declined: [],
        notKnown: [],
      },
      {
        answers: [
          {
            stepKey: "F1.categories",
            value: ["grain-storage analytics", "yes"],
            quote: "yes",
            ownWords: false,
            aboutStep: true,
            source: "STATED",
            affirms: true,
          },
        ],
        declined: [],
        notKnown: [],
      },
    ];
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      categories: (input) =>
        Promise.resolve(
          input.phrase === "grain-storage analytics" ? [AGRICULTURE] : [],
        ),
      reader: { read: () => Promise.resolve(readings.shift() ?? EMPTY) },
    });
    const line = lineOf("founder");
    await conversation.said?.(
      line,
      "Q",
      "Which industry would you place it in?",
      "F1.categories",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "We do grain-storage analytics for cooperatives.",
    );
    await conversation.flush?.(line);
    expect(world.recordedNote("F1.categories")).toBe(
      "Read as: “grain-storage analytics” as Agriculture.",
    );
    await conversation.said?.(
      line,
      "Q",
      "You're in agricultural technology, grain-storage analytics. Is that right?",
      "F1.categories",
    );
    await conversation.said?.(line, "PERSON", "yes");
    await conversation.flush?.(line);
    expect(world.recordedNote("F1.categories")).not.toMatch(/yes/iu);
    expect(world.recordedValue("F1.categories")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [AGRICULTURE],
    });
  });
});
