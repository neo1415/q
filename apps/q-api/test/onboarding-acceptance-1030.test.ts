import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import { wholeWordsWithin } from "../src/voice/interview-steps.js";
import { turnDedupeKey } from "../src/voice/onboarding-conductor.js";
import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Live MVP acceptance 2026-10-30 (production 4bcfa584b, fictional founder
 * "Hydrolume Analytics" and investor "Kortrijk Polder Ventures", typed).
 * No live model: the transcript reader is a fake that answers as the live
 * reading did.
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
const SESSION = "f0000000-0000-4000-8000-000000000031";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "founder" },
};

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;
const reader = (reading: () => Reading): OnboardingTranscriptReader => ({
  read: () => Promise.resolve(reading()),
});

const TEAM_Q =
  "Thanks — seven people in total. What does the founding team cover between you, such as product, engineering, sales and partnerships, or operations?";
const REVIEW_Q = "Here's what I understood. Does it look right?";
const NUMBERS =
  "Six pilots with cooperatives. We report in euros, burn about 45k a month, have around 600k in the bank, so roughly 13 months of runway.";

const world = () =>
  investorSession({
    servesTurnSteps: true,
    journey: "founder",
    currentStepKey: "F4.functions",
    subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000031" },
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Hydrolume Analytics (fictional)",
      "F1.stage": "seed",
    },
  });

const skipOnServer = async (w: ReturnType<typeof world>, stepKey: string) => {
  await w.fetch(
    `http://api.test/v1/onboarding/sessions/${SESSION}/steps/${stepKey}/skip`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedSessionVersion: 1,
        idempotencyKey: "a0000000-0000-4000-8000-000000000031",
      }),
    },
  );
};

/** The examples Q's question listed, as the live reading gave them. */
const EXAMPLES_AGREED = (quote: string): Reading => ({
  answers: [
    {
      stepKey: "F4.functions",
      value: ["product", "engineering", "sales", "operations"],
      quote,
      ownWords: false,
    },
  ],
  declined: [],
});

describe("a skipped answer stays skipped unless their own later words change it (Hydrolume)", () => {
  it("a yes to the review after the Skip never fills the skipped step with Q's examples", async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => EXAMPLES_AGREED("Yes, that looks right")),
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", TEAM_Q, "F4.functions");
    // The Skip button: the step set aside, and the skip kept with it.
    await skipOnServer(w, "F4.functions");
    await conversation.said?.(line, "PERSON", "Skip this one", "F4.functions");
    await conversation.said?.(line, "Q", REVIEW_Q, "F3.review");
    await conversation.said?.(line, "PERSON", "Yes, that looks right");
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toBeUndefined();
    expect(w.skippedSteps()).toContain("F4.functions");
  });

  it("an unrelated message later never reopens the skip", async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => EXAMPLES_AGREED(NUMBERS.slice(0, 40))),
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", TEAM_Q, "F4.functions");
    await skipOnServer(w, "F4.functions");
    await conversation.said?.(line, "PERSON", "Skip this one", "F4.functions");
    await conversation.said?.(
      line,
      "Q",
      "A few optional numbers would help: how many pilots?",
      "F5.pilots",
    );
    await conversation.said?.(line, "PERSON", NUMBERS);
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toBeUndefined();
  });

  it("without the skip kept in the thread, Q's own line before the skip is still not their answer", async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => EXAMPLES_AGREED("Yes, that looks right")),
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", TEAM_Q, "F4.functions");
    await skipOnServer(w, "F4.functions");
    // The review question the screen showed, kept before their yes.
    await conversation.said?.(line, "Q", REVIEW_Q, "F3.review");
    await conversation.said?.(line, "PERSON", "Yes, that looks right");
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toBeUndefined();
  });

  it("their own answer, when Q asks it again after the skip, is saved", async () => {
    const w = world();
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [
          {
            stepKey: "F4.functions",
            value: ["product", "sales"],
            quote: "Actually, we cover product and sales",
            ownWords: false,
          },
        ],
        declined: [],
      })),
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", TEAM_Q, "F4.functions");
    await skipOnServer(w, "F4.functions");
    await conversation.said?.(line, "PERSON", "Skip this one", "F4.functions");
    await conversation.said?.(
      line,
      "Q",
      "Coming back to the team: what does it cover?",
      "F4.functions",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "Actually, we cover product and sales",
    );
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["product", "sales"],
    });
  });
});

describe("not knowing is an answer (Kortrijk Polder)", () => {
  it("\"I don't know\" to Q's question takes back an optional answer saved before it", async () => {
    const w = world();
    w.record("F4.functions", {
      type: "MULTI_SELECT",
      optionKeys: ["product"],
    });
    // Saved before the words below.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [],
        declined: [{ stepKey: "F4.functions", quote: "I don't know" }],
      })),
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", TEAM_Q, "F4.functions");
    await conversation.said?.(line, "PERSON", "I don't know");
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toBeUndefined();
    expect(w.skippedSteps()).toContain("F4.functions");
  });

  it("a decline said to another question leaves what is on record", async () => {
    const w = world();
    w.record("F4.functions", {
      type: "MULTI_SELECT",
      optionKeys: ["product"],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [],
        declined: [{ stepKey: "F4.functions", quote: "I don't know" }],
      })),
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "How many pilots are running?",
      "F5.pilots",
    );
    await conversation.said?.(line, "PERSON", "I don't know");
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.functions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["product"],
    });
  });
});

describe("a second identical message to a different question is its own turn (Hydrolume solution yes)", () => {
  const send = (utterance: string, lastQ: string) => ({
    channel: "text",
    utterance,
    recentTurns: [
      { role: "q", text: lastQ },
      { role: "person", text: "earlier" },
    ],
  });

  it("the same words to different lines of Q's are different turns", () => {
    expect(
      turnDedupeKey(send("yes", "The problem is spoilage. Is that right?")),
    ).not.toBe(
      turnDedupeKey(send("yes", "The solution is probes. Is that right?")),
    );
  });

  it("a double send from one screen is still one turn", () => {
    const one = send("yes", "The problem is spoilage. Is that right?");
    expect(turnDedupeKey(one)).toBe(
      turnDedupeKey({ ...one, utterance: " Yes " }),
    );
  });
});

describe("a needed question they could not answer is never put again word for word (Kortrijk Polder)", () => {
  const copy = {
    labelOf: () => undefined,
    questionOf: (stepKey: string) =>
      stepKey === "I9.discovery_mode"
        ? "Should I stick closely to what you've told me, or also show a few just outside it?"
        : "How should founders reach you?",
  };
  const missing = [
    { stepKey: "I9.discovery_mode", question: "Discovery?" },
    { stepKey: "I10.inbound_preference", question: "Inbound?" },
  ];

  it("another needed one is asked first", () => {
    const first = finishingLine(
      "investor",
      { completed: false, missing },
      copy,
    );
    const again = finishingLine(
      "investor",
      { completed: false, missing },
      { ...copy, unsettled: "I9.discovery_mode" },
    );
    expect(again?.asking).toBe("I10.inbound_preference");
    expect(again?.reply).not.toBe(first?.reply);
  });

  it("alone, it is said to be needed, not repeated verbatim", () => {
    const only = [missing[0] ?? { stepKey: "", question: "" }];
    const first = finishingLine(
      "investor",
      { completed: false, missing: only },
      copy,
    );
    const again = finishingLine(
      "investor",
      { completed: false, missing: only },
      { ...copy, unsettled: "I9.discovery_mode" },
    );
    expect(again?.asking).toBe("I9.discovery_mode");
    expect(again?.reply).not.toBe(first?.reply);
    expect(again?.reply).toMatch(/change it any time/u);
  });
});

describe("a read-back never cuts an answer mid-sentence (Kortrijk Polder thesis)", () => {
  const THESIS =
    "Your thesis is focused on energy transition and industrial software supporting Northern Europe’s grid rebuild, including flexibility and energy-use software, with a preference for practical infrastructure over shiny hardware, founders with utility or heavy-industry experience and buyer access, and a concentrated portfolio of two or three deep bets rather than many small tickets.";

  it("keeps the 381-character thesis whole", () => {
    expect(wholeWordsWithin(THESIS, 600)).toBe(THESIS);
  });

  it("shortens only at a sentence or a word, and says so", () => {
    const long = `${THESIS} ${THESIS}`;
    const cut = wholeWordsWithin(long, 600);
    expect(cut.length).toBeLessThanOrEqual(601);
    expect(long.startsWith(cut.replace(/…$/u, ""))).toBe(true);
    expect(cut).toMatch(/(?:\.|…)$/u);
    const words = wholeWordsWithin("alpha beta gamma delta", 12);
    expect(words).toBe("alpha beta…");
  });
});
