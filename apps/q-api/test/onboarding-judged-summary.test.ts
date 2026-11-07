import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Onboarding P1-1 (DECISIONS 77, approved by the integration owner): Q
 * judges when to summarise. A clear answer, typed or spoken, is kept whole
 * in the person's words with only filler removed; a rambling one is held as
 * Q's summary for their yes. The reader judges by meaning (v14); code only
 * checks that "their own words" is structurally true (deletions only from
 * their line, most of it kept). Before P1-1 a 30-word count decided: a
 * clear 40-word answer was always summarised and a 25-word ramble was kept
 * verbatim with its filler. No live model: the reader is a fake that gives
 * what a v14 reading gives. Fictional founder only.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000011",
  tenantId: "c0000000-0000-4000-8000-000000000011",
  actorType: "HUMAN",
});
const SESSION = "f0000000-0000-4000-8000-000000000111";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "founder" },
};

const ASKED = "What does Fisiora do, in your own words?";
/** A clear typed answer of 45 words, with one "Um," at the start. */
const CLEAR =
  "Um, we sell a scheduling tool to independent physiotherapy clinics in Portugal and Spain. Clinics pay a monthly fee per therapist, and patients book, reschedule and pay online, which cuts no-shows by about a third and saves the front desk several hours each week.";
const CLEAR_KEPT =
  "We sell a scheduling tool to independent physiotherapy clinics in Portugal and Spain. Clinics pay a monthly fee per therapist, and patients book, reschedule and pay online, which cuts no-shows by about a third and saves the front desk several hours each week.";
/** A short spoken ramble of 27 words. */
const RAMBLE =
  "So we, uh, we basically, you know, help, I mean we help cafes, cafes and bakeries, like, sell their leftover bread, the leftover stuff, at night.";
const SUMMARY =
  "Helps cafes and bakeries sell their leftover bread in the evening.";

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;
const reader = (reading: Reading): OnboardingTranscriptReader => ({
  read: () => Promise.resolve(reading),
});
const description = (value: string, quote: string, ownWords: boolean) =>
  reader({
    answers: [
      {
        stepKey: "F1.description",
        value,
        quote,
        ownWords,
        source: "STATED",
      },
    ],
    declined: [],
  });

const world = () =>
  investorSession({
    servesTurnSteps: true,
    journey: "founder",
    currentStepKey: "F1.description",
    subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000000111" },
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Fisiora Agenda (fictional)",
      "F1.stage": "seed",
    },
  });

const answer = async (
  w: ReturnType<typeof world>,
  r: OnboardingTranscriptReader,
  said: string,
) => {
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: w.fetch,
    logger,
    readAfterMs: 5,
    reader: r,
    recommendations: w.recommendations,
  });
  await conversation.said?.(line, "Q", ASKED, "F1.description");
  await conversation.said?.(line, "PERSON", said);
  await conversation.flush?.(line);
};

const pending = (w: ReturnType<typeof world>) =>
  w.heldSuggestions().filter((s) => s.status === "PENDING");

describe("P1-1: Q judges when to summarise a long answer (DECISIONS 77)", () => {
  it("a clear 45-word typed answer, given as their words minus filler, is saved directly", async () => {
    // Failed before P1-1: over 30 words, so it was held for a say-back.
    const w = world();
    await answer(w, description(CLEAR_KEPT, CLEAR, true), CLEAR);
    expect(w.recordedValue("F1.description")).toEqual({
      type: "TEXT",
      text: CLEAR_KEPT,
    });
    expect(pending(w)).toEqual([]);
  });

  it("a rambling 27-word answer the reader judged a ramble is held for the read-back, never kept with its filler", async () => {
    // Failed before P1-1: 30 words or fewer and in their line, so the
    // filler-laden words were saved as the description.
    const w = world();
    const theirs =
      "we help cafes, cafes and bakeries, like, sell their leftover bread, the leftover stuff, at night";
    await answer(w, description(theirs, RAMBLE, false), RAMBLE);
    expect(w.recordedValue("F1.description")).toBeUndefined();
    expect(pending(w).map((s) => s.stepKey)).toEqual(["F1.description"]);
  });

  it("a rambling answer whose reading is Q's summary is held for their yes, not saved", async () => {
    const w = world();
    await answer(w, description(SUMMARY, RAMBLE, false), RAMBLE);
    expect(w.recordedValue("F1.description")).toBeUndefined();
    const held = pending(w);
    expect(held.map((s) => s.stepKey)).toEqual(["F1.description"]);
    expect(held[0]?.value).toEqual({ type: "TEXT", text: SUMMARY });
  });

  it("'their own words' that reword or add to their line are held for the read-back", async () => {
    const w = world();
    const reworded =
      "We sell a booking tool to physiotherapy clinics in Portugal and Spain. Clinics pay a monthly fee per therapist, and patients book, reschedule and pay online, which cuts no-shows by about a third and saves the front desk several hours each week.";
    await answer(w, description(reworded, CLEAR, true), CLEAR);
    expect(w.recordedValue("F1.description")).toBeUndefined();
    expect(pending(w).map((s) => s.stepKey)).toEqual(["F1.description"]);
  });

  it("'their own words' that keep too little of their line (a selection, not a cleaning) are held for the read-back", async () => {
    const w = world();
    await answer(
      w,
      description(
        "We sell a scheduling tool to physiotherapy clinics.",
        CLEAR,
        true,
      ),
      CLEAR,
    );
    expect(w.recordedValue("F1.description")).toBeUndefined();
    expect(pending(w).map((s) => s.stepKey)).toEqual(["F1.description"]);
  });
});
