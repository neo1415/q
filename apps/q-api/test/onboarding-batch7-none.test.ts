import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import {
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_LIST_THEMES,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
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

/**
 * e2e run 5 (production batch 9, 2026-11-08): "Are there sectors you'd
 * rather not see?" -- the finishing line's own one-list question -- was
 * answered "None." seven times and never saved: the reading did not take
 * it as a decline the port accepted. A plain none to what Q's last line
 * asked is settled by code, before and whatever the reading says.
 */
describe("a plain none to the one list Q asked (e2e run 5)", () => {
  const quiet: OnboardingTranscriptReader = {
    read: () => Promise.resolve({ answers: [], declined: [] }),
  };
  const v5World = () =>
    investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      servesTurnSteps: true,
      currentStepKey: INVESTOR_STEPS.sectorsAvoid,
      subject: FIRM,
      recorded: { "I0.investor_type": "vc" },
    });
  const talk = async (
    w: ReturnType<typeof v5World>,
    q: string,
    asked: string,
    said: string,
  ) => {
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: quiet,
      recommendations: w.recommendations,
    });
    await conversation.said?.(line, "Q", q, asked);
    await conversation.said?.(line, "PERSON", said);
    await conversation.flush?.(line);
  };

  it("'None.' to sectors you'd rather not see is saved, for what they do not want to see", async () => {
    const w = v5World();
    await talk(
      w,
      "Before I can finish, I still need 7 more answers from you, starting with this one. Are there sectors you'd rather not see?",
      INVESTOR_STEPS.sectorsAvoid,
      "None.",
    );
    for (const key of [
      INVESTOR_STEPS.sectorsAvoid,
      INVESTOR_STEPS.avoid,
      INVESTOR_STEPS.hardExclusions,
      INVESTOR_STEPS.sectorExclusions,
    ]) {
      expect(w.recordedValue(key)).toEqual({ type: "TEXT", text: "None" });
    }
  });

  it("'No preference.' to business models is None for business models only", async () => {
    const w = v5World();
    await talk(
      w,
      "Which business models do you back?",
      INVESTOR_STEPS.businessModels,
      "No preference.",
    );
    expect(w.recordedValue(INVESTOR_STEPS.businessModels)).toEqual({
      type: "TEXT",
      text: "None",
    });
    expect(w.recordedValue(INVESTOR_STEPS.customerTypes)).toBeUndefined();
    expect(w.recordedValue(INVESTOR_STEPS.revenueState)).toBeUndefined();
  });

  it("an answer with content is left to the reading", async () => {
    const w = v5World();
    await talk(
      w,
      "Which business models do you back?",
      INVESTOR_STEPS.businessModels,
      "Subscription software, mostly.",
    );
    expect(w.recordedValue(INVESTOR_STEPS.businessModels)).toBeUndefined();
  });
});

describe("the checklist gives the themes in their own words (e2e run 5)", () => {
  it("so a plain none to a theme settles the theme, not one list", async () => {
    const w = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      currentStepKey: INVESTOR_STEPS.sectorsAvoid,
      subject: FIRM,
    });
    const port = createOnboardingPort({
      session: turn(w, "").session,
      onboardingSessionId: turn(w, "").onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
    });
    const brief = briefOf(await port.state());
    for (const theme of INVESTOR_LIST_THEMES) {
      expect(brief).toContain(JSON.stringify(theme.question));
    }
    expect(brief).toMatch(/never take a list they did not address as none/u);
  });
});

/**
 * Production 01:03:37 (run 5): the reader filed a bare "None." to "sectors
 * you'd rather not see" as their additional context, and nothing landed
 * on the exclusion lists. A bare none answers only what Q asked.
 */
describe("a bare none is never filed under a step Q did not ask (run 5)", () => {
  it("the reader's additional_context=None. is dropped; the asked list is settled", async () => {
    const w = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      servesTurnSteps: true,
      currentStepKey: INVESTOR_STEPS.sectorsAvoid,
      subject: FIRM,
      recorded: { "I0.investor_type": "vc" },
    });
    const misfiling: OnboardingTranscriptReader = {
      read: () =>
        Promise.resolve({
          answers: [
            {
              stepKey: INVESTOR_STEPS.additionalContext,
              value: "None.",
              quote: "None.",
              ownWords: true,
            },
          ],
          declined: [],
        }),
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: w.fetch,
      logger,
      readAfterMs: 5,
      reader: misfiling,
      recommendations: w.recommendations,
    });
    await conversation.said?.(
      line,
      "Q",
      "Are there any sectors you'd rather not see, or is there no particular sector to avoid?",
      INVESTOR_STEPS.sectorsAvoid,
    );
    await conversation.said?.(line, "PERSON", "None.");
    await conversation.flush?.(line);
    expect(w.recordedValue(INVESTOR_STEPS.additionalContext)).toBeUndefined();
    expect(w.recordedValue(INVESTOR_STEPS.sectorsAvoid)).toEqual({
      type: "TEXT",
      text: "None",
    });
  });

  it("words with content are still the reader's, whatever step it files them under", async () => {
    const w = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      servesTurnSteps: true,
      currentStepKey: INVESTOR_STEPS.sectorsAvoid,
      subject: FIRM,
      recorded: { "I0.investor_type": "vc" },
    });
    const said = "None, but we love climate founders who sell to utilities.";
    const reader: OnboardingTranscriptReader = {
      read: () =>
        Promise.resolve({
          answers: [
            {
              stepKey: INVESTOR_STEPS.additionalContext,
              value: "We love climate founders who sell to utilities.",
              quote: "we love climate founders who sell to utilities",
              ownWords: true,
            },
          ],
          declined: [],
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
      "Are there sectors you'd rather not see?",
      INVESTOR_STEPS.sectorsAvoid,
    );
    await conversation.said?.(line, "PERSON", said);
    await conversation.flush?.(line);
    expect(w.recordedValue(INVESTOR_STEPS.additionalContext)).toBeDefined();
  });
});
