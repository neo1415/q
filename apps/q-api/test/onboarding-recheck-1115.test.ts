import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import { describeValue, YEAR_STEP } from "../src/voice/interview-steps.js";
import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Live founder re-check 2026-11-15 (64637e8c9), D8: Q's read-back printed
 * "Founding year: 2,024 Shall I keep that?", and kept asking for that yes
 * after "We founded it in 2024." to its own year question. No live model:
 * the transcript reader is a fake that answers as the live reading did.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000001115",
  tenantId: "c0000000-0000-4000-8000-000000001115",
  actorType: "HUMAN",
});
const SESSION = "f0000000-0000-4000-8000-000000001115";
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

const yearStep = FOUNDER_DEFINITION_CURRENT.steps.find(
  (step) => step.stepKey === "F1.founded_year",
);

describe("D8: a year is a year", () => {
  it("is never printed with a thousands separator", () => {
    expect(yearStep).toBeDefined();
    expect(describeValue(yearStep, { type: "RANGE", value: "2024" })).toBe(
      "2024",
    );
  });

  it("only year steps; a figure keeps its grouping", () => {
    expect(YEAR_STEP.test("F1.founded_year")).toBe(true);
    expect(YEAR_STEP.test("F4.team_size")).toBe(false);
    const team = FOUNDER_DEFINITION_CURRENT.steps.find(
      (step) => step.stepKey === "F5.customers",
    );
    expect(describeValue(team, { type: "RANGE", value: "1850" })).toBe("1,850");
  });

  it("a clear answer to Q's year question settles it at once, never held for a yes", async () => {
    const w = investorSession({
      servesTurnSteps: true,
      journey: "founder",
      currentStepKey: "F1.founded_year",
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000001115" },
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Mangrove Tally (fictional)",
        "F1.stage": "seed",
      },
    });
    const said = "We founded it in 2024.";
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [
          {
            stepKey: "F1.founded_year",
            value: 2024,
            quote: said,
            ownWords: true,
            source: "STATED",
          },
        ],
        declined: [],
      })),
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "Seed stage — understood. What year was Mangrove Tally founded?",
      "F1.founded_year",
    );
    await conversation.said?.(line, "PERSON", said);
    await conversation.flush?.(line);
    expect(w.recordedValue("F1.founded_year")).toBeDefined();
    expect(
      w
        .heldSuggestions()
        .filter((s) => s.status === "PENDING")
        .map((s) => s.stepKey),
    ).not.toContain("F1.founded_year");
  });

  it("a figure is still held for its read-back (D-OWN-3, DECISIONS 78)", async () => {
    const w = investorSession({
      servesTurnSteps: true,
      journey: "founder",
      currentStepKey: "F4.team_size",
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000001115" },
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Mangrove Tally (fictional)",
        "F1.stage": "seed",
      },
    });
    const said = "There are nine of us.";
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [
          {
            stepKey: "F4.team_size",
            value: 9,
            quote: said,
            ownWords: true,
            source: "STATED",
          },
        ],
        declined: [],
      })),
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "How many people work on the company?",
      "F4.team_size",
    );
    await conversation.said?.(line, "PERSON", said);
    await conversation.flush?.(line);
    expect(w.recordedValue("F4.team_size")).toBeUndefined();
  });
});
