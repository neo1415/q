import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  OnboardingTranscriptReader,
  QDelegationReader,
} from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { createDefaultPromptRegistry } from "@capital-q/q-core";
import type { OnboardingState, OnboardingStepState } from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  briefOf,
  createOnboardingConversation,
  placeOfQuote,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";
import { reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live 2026-10-30 (production 92a12534c, session 060be17c, a fictional
 * founder, typed path). No live model: the transcript reader is a fake that
 * answers as the live reading did, from what it is shown.
 *
 * 1. A long answer to "website, base, what it does, sector" was never said
 *    back; Q moved on.
 * 3. "yes that's right" (to something else) and the next reading saved the
 *    raw ramble minus "so basically, um" as the description.
 * 4. Every reading re-held five freshly worded summaries, expiring the ones
 *    on screen; the founder's Keep came back 409 on all four.
 * 5. "No website yet" left the website open, and Q asked it again.
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
const SESSION = "f0000000-0000-4000-8000-000000000030";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "founder" },
};

const ASKED =
  "Thanks, Tomasz. The essentials are covered; let's fill in a few optional basics, and you can skip any of them: do you have a website, where is Granary based, what does it do in a sentence or two, and what sector would you place it in?";
const RAMBLE =
  "So basically, um, what we do is we help small grain cooperatives in Poland and the Baltics keep track of what's actually sitting in their silos, because right now most of them are still on paper ledgers and spreadsheets and they lose a lot of money on spoilage and mis-weighed loads. We put cheap moisture and weight sensors in the bins and connect them to a little web app, and the co-op manager can see stock, quality and who delivered what, and it also produces the paperwork the banks want when they lend against the stored grain. The way we make money is a monthly subscription per silo site, roughly 300 euros a month, plus a one-off installation fee for the sensors, and we're starting to take a small fee when a bank uses our stock reports to approve a warehouse-receipt loan. Honestly the lending part is the bit that excites us most, but the subscriptions are what pays the bills today. We have about twenty co-ops on it so far, mostly around Lublin.";
/** The live reading's description: the ramble minus its opening filler. */
const RAW_DESCRIPTION =
  "we help small grain cooperatives in Poland and the Baltics keep track of what's actually sitting in their silos, because right now most of them are still on paper ledgers and spreadsheets and they lose a lot of money on spoilage and mis-weighed loads";
const SAID_BACK =
  "So, to check I have it: Granary gives small grain co-ops in Poland and the Baltics sensors and a web app to track the stock and quality in their silos and the paperwork banks need to lend against it. It makes money from a monthly subscription per silo site, an installation fee, and a small fee when a bank uses its stock reports for a loan. Is that right?";
const DESCRIPTION_SAID =
  "Granary gives small grain co-ops in Poland and the Baltics sensors and a web app to track the stock and quality in their silos and the paperwork banks need to lend against it.";
const MODEL_SAID =
  "It makes money from a monthly subscription per silo site, an installation fee, and a small fee when a bank uses its stock reports for a loan.";

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

/** A reader that gives each reading in turn, the last one from then on. */
const readings = (...steps: Reading[]) => {
  const seen: number[] = [];
  const reader: OnboardingTranscriptReader = {
    read: (input) => {
      seen.push(input.turns.length);
      return Promise.resolve(
        steps[Math.min(seen.length - 1, steps.length - 1)] ?? null,
      );
    },
  };
  return { reader, seen };
};

/** What the live reading gave for the ramble: its words, not yet agreed. */
const RAMBLE_READING: Reading = {
  answers: [
    {
      stepKey: "F1.description",
      value: RAW_DESCRIPTION,
      quote: RAMBLE.slice(18, 300),
      ownWords: true,
    },
    {
      stepKey: "F9.business_model",
      value:
        "A monthly subscription per silo site, roughly 300 euros a month, plus a one-off sensor installation fee.",
      quote:
        "The way we make money is a monthly subscription per silo site, roughly 300 euros a month",
      ownWords: false,
    },
  ],
  declined: [],
};

const world = () =>
  investorSession({
    servesTurnSteps: true,
    journey: "founder",
    currentStepKey: "F1.website",
    subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000030" },
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Granary Ledger Systems (fictional)",
      "F1.stage": "seed",
    },
  });

describe("live 2026-10-30 (Granary): a long typed answer is said back and saved only as the summary they agreed to", () => {
  it("the ramble alone saves nothing raw: each narrative answer is held for their yes", async () => {
    const w = world();
    const { reader } = readings(RAMBLE_READING);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", ASKED, "F1.website");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    expect(w.recordedValue("F1.description")).toBeUndefined();
    expect(w.recordedValue("F9.business_model")).toBeUndefined();
    const held = w.heldSuggestions().filter((s) => s.status === "PENDING");
    expect(held.map((s) => s.stepKey).sort()).toEqual([
      "F1.description",
      "F9.business_model",
    ]);
  });

  it("re-reading the same words never replaces what is held (the 409: Keep on an expired summary)", async () => {
    const w = world();
    // The second reading words the same answers differently, from the
    // same old quotes, as the live readings did every time.
    const reworded: Reading = {
      answers: (RAMBLE_READING?.answers ?? []).map((answer) => ({
        ...answer,
        value:
          typeof answer.value === "string"
            ? `${answer.value} (reworded)`
            : answer.value,
      })),
      declined: [],
    };
    const { reader } = readings(RAMBLE_READING, reworded);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", ASKED, "F1.website");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    const first = w.heldSuggestions().map((s) => s.id);
    await conversation.said?.(
      line,
      "Q",
      "For the round, which currency are you raising in and how much?",
      "F6.currency",
    );
    await conversation.said?.(line, "PERSON", "Euro, about 1.5 million");
    await conversation.flush?.(line);
    const after = w.heldSuggestions();
    // Nothing new held, nothing expired: the ids on their screen stand.
    expect(after.map((s) => s.id)).toEqual(first);
    expect(after.every((s) => s.status === "PENDING")).toBe(true);
  });

  it("their yes to Q's say-back saves Q's words, never the ramble", async () => {
    const w = world();
    const agreed: Reading = {
      answers: [
        {
          stepKey: "F1.description",
          value: DESCRIPTION_SAID,
          quote: "yes that's right",
          ownWords: false,
        },
        {
          stepKey: "F9.business_model",
          value: MODEL_SAID,
          quote: "yes that's right",
          ownWords: false,
        },
      ],
      declined: [],
    };
    const { reader } = readings(RAMBLE_READING, agreed);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", ASKED, "F1.website");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    await conversation.said?.(line, "Q", SAID_BACK, "F1.description");
    await conversation.said?.(line, "PERSON", "yes that's right");
    await conversation.flush?.(line);
    expect(w.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: DESCRIPTION_SAID,
    });
    expect(w.recordedValue("F9.business_model")).toEqual({
      type: "TEXT",
      text: MODEL_SAID,
    });
  });

  it("a 'yes' to a line that never said the summary back saves nothing (live: the raw description was saved after 'yes that's right' to the raise)", async () => {
    const w = world();
    // The live third reading: the ramble's words given as the value, on
    // the strength of a later yes to a different line.
    const later: Reading = {
      answers: [
        {
          stepKey: "F1.description",
          value: RAW_DESCRIPTION,
          quote: "yes that's right",
          ownWords: true,
        },
      ],
      declined: [],
    };
    const { reader } = readings(RAMBLE_READING, later);
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", ASKED, "F1.website");
    await conversation.said?.(line, "PERSON", RAMBLE);
    await conversation.flush?.(line);
    await conversation.said?.(
      line,
      "Q",
      "Understood: you're raising €1.5 million, with the subscription business funding the company today. Is there a website for Granary, and where is the company based?",
      "F1.website",
    );
    await conversation.said?.(line, "PERSON", "yes that's right");
    await conversation.flush?.(line);
    expect(w.recordedValue("F1.description")).toBeUndefined();
  });

  it("a short answer that is their own line is saved as it stands (nothing to say back)", async () => {
    const w = world();
    const { reader } = readings({
      answers: [
        {
          stepKey: "F1.description",
          value: "Grain stock tracking for farming co-ops.",
          quote: "Grain stock tracking for farming co-ops.",
          ownWords: true,
        },
      ],
      declined: [],
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "What does Granary do, in a line?",
      "F1.description",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "Grain stock tracking for farming co-ops.",
    );
    await conversation.flush?.(line);
    expect(w.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: "Grain stock tracking for farming co-ops.",
    });
  });
});

describe("live 2026-10-30 item 5: 'No website yet' settles the website", () => {
  it("a stated absence read as declined sets the optional step aside; it is not left open", async () => {
    const w = world();
    const { reader } = readings({
      answers: [],
      declined: [{ stepKey: "F1.website", quote: "No website yet." }],
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "Is there a website for Granary, and where is the company based?",
      "F1.website",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "No website yet. We're based in Lublin, Poland.",
    );
    await conversation.flush?.(line);
    expect(w.skippedSteps()).toContain("F1.website");
    expect(w.recordedValue("F1.website")).toBeUndefined();
  });

  it("the reader's prompt reads a stated absence as declined, and a long-text step as Q's agreed summary", () => {
    const registry = createDefaultPromptRegistry();
    const reader = registry.getActive("ONBOARDING_TRANSCRIPT_READER");
    // v8 (live acceptance 2026-10-30) keeps these rules.
    expect(reader.definition.version).toBeGreaterThanOrEqual(7);
    expect(reader.definition.template).toContain("no website yet");
    expect(reader.definition.template).toContain("LONG_TEXT");
    const reply = registry.getActive("ONBOARDING_TYPED_REPLY");
    expect(reply.definition.version).toBe(4);
    expect(reply.definition.template).toContain("(say back)");
  });
});

describe("the conversation's checklist asks Q to say a long answer back", () => {
  const step = (
    stepKey: string,
    status: OnboardingStepState["status"],
  ): OnboardingStepState => ({
    stepKey,
    question: stepKey,
    kind: "TEXT",
    required: false,
    status,
    value: null,
  });
  it("open long-text topics are marked (say back) with the rule; answered ones are not", () => {
    const state = {
      journey: "founder",
      steps: [
        step("F1.website", "OPEN"),
        step("F1.description", "OPEN"),
        step("F9.business_model", "ANSWERED"),
      ],
    } as unknown as OnboardingState;
    const brief = briefOf(state, { withIds: true });
    expect(brief).toMatch(
      /F1\.description \(say back\)|\(say back\).*F1\.description/u,
    );
    expect(brief).not.toMatch(/F1\.website.*\(say back\)/u);
    expect(brief).toContain("say back in your own plain words");
  });
});

describe("placeOfQuote: the Q line a quote answered, however late the reading", () => {
  it("finds the person's line by its words and the Q line before it", () => {
    const place = placeOfQuote([
      { role: "Q", text: "First question?", createdAt: "2026-10-30T17:51:18Z" },
      { role: "PERSON", text: RAMBLE, createdAt: "2026-10-30T17:51:29Z" },
      { role: "Q", text: SAID_BACK, createdAt: "2026-10-30T17:51:34Z" },
      {
        role: "PERSON",
        text: "yes that's right",
        createdAt: "2026-10-30T17:51:50Z",
      },
      { role: "Q", text: "Which currency?", createdAt: "2026-10-30T17:52:00Z" },
      {
        role: "PERSON",
        text: "Euro, about 1.5 million",
        createdAt: "2026-10-30T17:52:13Z",
      },
    ]);
    expect(place.qLineBefore("yes that's right")).toBe(SAID_BACK);
    expect(place.saidAt("yes that's right")).toBe("2026-10-30T17:51:50Z");
    expect(place.qLineBefore("The way we make money")).toBe("First question?");
    expect(place.qLineBefore("never said")).toBeUndefined();
  });
});

describe("typed: the say-back is asked for, and their yes is read against it", () => {
  it("the reply model is told to say a long answer back, and the reading of their yes is told what Q asked", async () => {
    const w = world();
    const seenPrompts: string[] = [];
    const script = [
      {
        reply: SAID_BACK,
        asking: "F1.description",
      },
      {
        reply: "Thanks. Which currency are you raising in?",
        asking: "F6.currency",
      },
    ];
    let index = 0;
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        seenPrompts.push(request.messages.map((m) => m.content).join("\n"));
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
    const asked: (string | null | undefined)[] = [];
    const delegation: QDelegationReader = {
      read: (input) => {
        asked.push(input.askedStep);
        return Promise.resolve(reading({}));
      },
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: readings(RAMBLE_READING).reader,
      recommendations: w.recommendations,
    });
    const typed = createTypedOnboarding({
      conversation,
      gateway,
      delegation,
      recommendations: w.recommendations,
      logger,
    });
    const first = await typed.turn({ ...turn(w, RAMBLE), actor });
    expect(first?.reply).toBe(SAID_BACK);
    // The checklist the reply was written from marks the long topics.
    expect(seenPrompts[0]).toContain("(say back)");
    expect(seenPrompts[0]).toContain("Topics marked (say back)");
    await typed.turn({ ...turn(w, "yes that's right"), actor });
    // "yes that's right" is read as an answer to the say-back, never a
    // reply to no question (live: it was read as finishing).
    expect(asked).toEqual([undefined, "F1.description"]);
  });
});
