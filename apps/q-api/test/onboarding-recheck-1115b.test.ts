import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { coverageProfileFor } from "../src/voice/onboarding-port.js";
import { groupedSaved } from "../src/voice/typed-onboarding.js";
import { oneMetricPerFigure } from "../src/voice/value-support.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Live founder re-check 2026-11-15 (84ac9afa7): "About US$48,000 a month."
 * answered Q's burn question; it was saved as the burn and ALSO queued as
 * an unsaved suggestion "Monthly revenue: $48,000". One stated figure maps
 * to one metric, the one Q asked about. No live model: the reader is a
 * fake filing the figure under both steps, as the live reading did.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000011152",
  tenantId: "c0000000-0000-4000-8000-000000011152",
  actorType: "HUMAN",
});
const SESSION = "f0000000-0000-4000-8000-000000011152";
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
const SAID = "About US$48,000 a month.";
const BURN = "F5.monthly_burn";
const REVENUE = "F5.monthly_revenue";

describe("one stated figure, one metric", () => {
  it("the burn Q asked about is held; the same figure is not also offered as monthly revenue", async () => {
    const w = investorSession({
      servesTurnSteps: true,
      journey: "founder",
      currentStepKey: BURN,
      subject: { type: "COMPANY", id: "e0000000-0000-4000-8000-000000011152" },
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Mangrove Tally (fictional)",
        "F1.stage": "seed",
        "F5.revenue_status": "recurring_revenue",
        "F5.reporting_currency": "USD",
      },
    });
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: reader(() => ({
        answers: [
          {
            stepKey: BURN,
            value: 48000,
            quote: SAID,
            ownWords: true,
            source: "STATED",
          },
          {
            stepKey: REVENUE,
            value: 48000,
            quote: SAID,
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
      "What's your monthly burn, roughly?",
      BURN,
    );
    await conversation.said?.(line, "PERSON", SAID);
    await conversation.flush?.(line);
    const pending = w
      .heldSuggestions()
      .filter((s) => s.status === "PENDING")
      .map((s) => s.stepKey);
    expect(pending).toContain(BURN);
    expect(pending).not.toContain(REVENUE);
    expect(w.recordedValue(REVENUE)).toBeUndefined();
  });

  it("with no step asked, what they stated wins over Q's inference", () => {
    const kept = oneMetricPerFigure(
      [
        { stepKey: REVENUE, value: 48000, quote: SAID, source: "INFERRED" },
        { stepKey: BURN, value: SAID, quote: SAID, source: "STATED" },
      ],
      new Set<string>(),
    );
    expect(kept.map((a) => a.stepKey)).toEqual([BURN]);
  });

  it("a figure said twice answers two steps; prose that contains it is untouched", () => {
    const twice = "Cheques of 25k, sometimes 25k more in follow-ons.";
    expect(
      oneMetricPerFigure(
        [
          { stepKey: "I2.cheque_min", value: 25000, quote: twice },
          { stepKey: "I2.cheque_typical", value: 25000, quote: twice },
        ],
        new Set<string>(),
      ),
    ).toHaveLength(2);
    const prose =
      "We sell bookkeeping to 1,850 informal retailers across Lagos and Accra over WhatsApp.";
    expect(
      oneMetricPerFigure(
        [
          { stepKey: "F1.description", value: prose, quote: prose },
          { stepKey: "F5.customers", value: 1850, quote: prose },
        ],
        new Set<string>(),
      ),
    ).toHaveLength(2);
  });
});

describe("the saved summary reads back every saved field", () => {
  /** The rows the live "Here's what I have saved" was read from. */
  const row = (stepKey: string, value: string) => ({
    stepKey,
    question: stepKey,
    kind: "TEXT" as const,
    required: true,
    status: "ANSWERED" as const,
    value,
  });
  const state = {
    journey: "founder" as const,
    currentStepKey: "F3.review",
    canComplete: true,
    completed: false,
    checks: [],
    steps: [
      row("F1.company_name", "Mangrove Tally (fictional)"),
      row("F1.website", "https://mangrovetally.example"),
      row("F1.country", "Nigeria"),
      row("F1.city", "I don't know"),
      row("F1.founded_year", "2024"),
      row("F1.one_line", "Bookkeeping for informal retailers on WhatsApp"),
      row("F1.stage", "Seed"),
    ],
  };
  const labelOf = (key: string) =>
    coverageProfileFor("founder").fields[key]?.label;

  it("includes the founding year, the city and the one line, and says a not-known one as such", () => {
    const readBack = groupedSaved(state, "founder", labelOf).join("\n");
    expect(readBack).toMatch(/Founding year: 2024/u);
    expect(readBack).toMatch(/City: Not known/u);
    expect(readBack).not.toMatch(/I don't know/u);
    expect(readBack).toMatch(
      /In one line: Bookkeeping for informal retailers on WhatsApp/u,
    );
    expect(readBack).toMatch(/Country: Nigeria/u);
  });

  it("a city they gave is read back as they gave it", () => {
    const withCity = {
      ...state,
      steps: state.steps.map((s) =>
        s.stepKey === "F1.city" ? { ...s, value: "Lagos" } : s,
      ),
    };
    expect(groupedSaved(withCity, "founder", labelOf).join("\n")).toMatch(
      /City: Lagos/u,
    );
  });
});
