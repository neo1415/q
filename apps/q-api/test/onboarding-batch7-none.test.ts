import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";

import {
  briefOf,
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Batch 7 (DECISIONS 79): every preference list the investor profile shows
 * is mandatory (investor v5), and "none" or "no preference" is the honest
 * answer for many people. A required step could not be set aside, so "no
 * preference" left the list open and Q asked it again. "None" now answers
 * it: settled, holding nothing.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000007",
  tenantId: "c0000000-0000-4000-8000-000000000007",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000007",
};
const SESSION = "77777777-7777-4777-8777-777777777777";
const line: ConversationLine = {
  voiceSessionId: `typed:${SESSION}`,
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "investor" },
};
const EXCLUSIONS = "I7.hard_exclusions";

function world() {
  return investorSession({
    currentStepKey: EXCLUSIONS,
    subject: FIRM,
    recorded: { "I0.investor_type": "vc" },
  });
}

describe('"None" answers a mandatory preference list (batch 7)', () => {
  it('"nothing I\'d never want to see" records None, and the list is settled', async () => {
    const w = world();
    const reader: OnboardingTranscriptReader = {
      read: () =>
        Promise.resolve({
          answers: [],
          declined: [
            {
              stepKey: EXCLUSIONS,
              quote: "No, nothing I'd never want to see.",
              saidSo: true,
            },
          ],
        }),
    };
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
      "Is there anything you never want to be shown?",
      EXCLUSIONS,
    );
    await conversation.said?.(
      line,
      "PERSON",
      "No, nothing I'd never want to see.",
    );
    await conversation.flush?.(line);
    expect(w.recordedValue(EXCLUSIONS)).toEqual({ type: "TEXT", text: "None" });
  });

  it("the checklist marks the lists None answers, and asks them in few questions", async () => {
    const w = world();
    const port = createOnboardingPort({
      session: turn(w, "").session,
      onboardingSessionId: turn(w, "").onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
    });
    const brief = briefOf(await port.state());
    expect(brief).toMatch(/\(none is an answer\)/u);
    expect(brief).toMatch(/as few natural questions as you can/u);
    expect(brief).not.toMatch(/saying they can skip|they may skip/iu);
  });
});
