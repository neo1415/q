import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { INVESTOR_DEFINITION_V5 } from "@capital-q/investor-onboarding";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { createDefaultPromptRegistry } from "@capital-q/q-core";
import { countryOfIso } from "@capital-q/taxonomy";

import {
  createOnboardingConversation,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";

import { livePrompt } from "../src/voice/live/prompt.js";
import { isPlainYes } from "../src/voice/typed-onboarding.js";

import { investorSession } from "./interviewer-fixtures.js";

/**
 * Owner, live duplex voice onboarding, production c92789167, 9 Nov
 * (qVoiceSession 12a0275a, investor). No live model: readings are fakes
 * answering as the live reader did (q-api "read and saved" log lines).
 *
 * 1. "It's based in um, San Francisco, California, in the USA": every
 *    reading from 12:36:08 logged notSaved I0.hq_country:REJECTED. The
 *    geography lookup has no "USA" (only "US" as an alias), so nothing was
 *    placed and Q asked again, four times.
 * 2. "Yes" (12:37:10) never saved I1.deployment_status: held as an "unasked
 *    judgement" on every reading to the end. Duplex keeps Q's spoken lines
 *    with no step, so code never knew Q's line asked it, and an askOnly
 *    step was only ever held.
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
/** A duplex line: its id is the voice session's, not "typed:". */
const DUPLEX: ConversationLine = {
  voiceSessionId: "12a0275a-d139-46fc-b2b7-2610668e5bcb",
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: { sessionId: SESSION, journeyType: "investor" },
};

type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;
const EMPTY: NonNullable<Reading> = { answers: [], declined: [], notKnown: [] };

function duplexWorld(currentStepKey: string) {
  const world = investorSession({
    currentStepKey,
    subject: FIRM,
    servesTurnSteps: true,
    steps: INVESTOR_DEFINITION_V5.steps,
    recorded: {
      "I0.investor_type": "vc",
      "I0.organisation_name": "Zion Capital",
    },
  });
  const readings: Reading[] = [];
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: world.fetch,
    logger,
    readAfterMs: 5,
    recommendations: world.recommendations,
    reader: { read: () => Promise.resolve(readings.shift() ?? EMPTY) },
  });
  return { world, readings, conversation };
}

const US = countryOfIso("US");

describe("1. a country said in a voice answer is saved as the country", () => {
  it.each([
    ["USA", "It's in the USA"],
    [
      "San Francisco, California, in the USA",
      "It's based in um, San Francisco, California, in the USA",
    ],
    ["the US", "Yes, I'm in the US"],
    ["United States of America", "the United States of America"],
  ])("%s", async (value, quote) => {
    const { world, readings, conversation } = duplexWorld("I0.hq_country");
    readings.push({
      answers: [
        {
          stepKey: "I0.hq_country",
          value,
          quote,
          ownWords: false,
          aboutStep: true,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    // Duplex: Q's spoken line carries no step.
    await conversation.said?.(DUPLEX, "Q", "And the firm is based where?");
    await conversation.said?.(DUPLEX, "PERSON", quote);
    await conversation.flush?.(DUPLEX);
    expect(world.recordedValue("I0.hq_country")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [US?.nodeId],
    });
  });
});

describe("2. their yes to Q's spoken question saves a judgement step", () => {
  it("duplex: 'Yes, I am' to 'actively investing right now?' saves deployment status", async () => {
    const { world, readings, conversation } = duplexWorld(
      "I1.deployment_status",
    );
    readings.push({
      answers: [
        {
          stepKey: "I1.deployment_status",
          value: "actively_investing",
          quote: "Yes, I am",
          ownWords: false,
          aboutStep: true,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await conversation.said?.(
      DUPLEX,
      "Q",
      "Are you actively investing right now?",
    );
    await conversation.said?.(DUPLEX, "PERSON", "Yes, I am.");
    await conversation.flush?.(DUPLEX);
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
  });

  it("still held when the reading does not say their words answered that question", async () => {
    const { world, readings, conversation } = duplexWorld(
      "I1.deployment_status",
    );
    readings.push({
      answers: [
        {
          stepKey: "I1.deployment_status",
          value: "actively_investing",
          quote: "We write cheques of 500k to 3 million",
          ownWords: false,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await conversation.said?.(DUPLEX, "Q", "How do you invest?");
    await conversation.said?.(
      DUPLEX,
      "PERSON",
      "We write cheques of 500k to 3 million.",
    );
    await conversation.flush?.(DUPLEX);
    expect(world.recordedValue("I1.deployment_status")).toBeUndefined();
  });
});

describe("4. the live interview asks one thing at most twice (D77)", () => {
  it("the INTERVIEW block caps a repeated question and says what happens then", () => {
    const prompt = livePrompt({
      interview: "- Needed: Where is your firm based?",
    });
    expect(prompt).toContain("Never ask the same thing more than twice");
    expect(prompt).toContain("leave it for now");
  });
});

describe("5. a confirmation is more than 'yes' (owner, 9 Nov)", () => {
  it.each([
    "Yep",
    "Yes",
    "That's very correct.",
    "Correct",
    "Exactly",
    "That's right",
    "Mm-hm",
    "Mhm.",
    "Sure",
    "Right",
    "Go ahead",
    "Yes, exactly right",
    "Absolutely",
    "Yeah, that's correct",
    "Uh-huh",
    "Spot on",
  ])("%s accepts", (said) => {
    expect(isPlainYes(said)).toBe(true);
  });

  it.each([
    "No",
    "Not quite",
    "Right, but the minimum is 250k",
    "Yes, but make it 400k",
    "That's not right",
    "Correct me if I'm wrong, it's 3 million",
    "",
  ])("%s does not", (said) => {
    expect(isPlainYes(said)).toBe(false);
  });
});

describe("6. session 12a0275a replayed: what they said is saved", () => {
  it("country, the yes to deployment, and both cheques via a spoken read-back", async () => {
    const { world, readings, conversation } = duplexWorld("I0.hq_country");
    const say = async (q: string, person: string, reading: Reading) => {
      readings.push(reading);
      await conversation.said?.(DUPLEX, "Q", q);
      await conversation.said?.(DUPLEX, "PERSON", person);
      await conversation.flush?.(DUPLEX);
    };
    const one = (
      stepKey: string,
      value: string | number,
      quote: string,
    ): Reading => ({
      answers: [
        {
          stepKey,
          value,
          quote,
          ownWords: false,
          aboutStep: true,
          source: "STATED",
        },
      ],
      declined: [],
      notKnown: [],
    });
    await say(
      "And the firm is based where?",
      "It's based in um, San Francisco, California, in the USA",
      one(
        "I0.hq_country",
        "San Francisco, California, in the USA",
        "It's based in um, San Francisco, California, in the USA",
      ),
    );
    await say(
      "Are you actively investing right now?",
      "Yes, I am",
      one("I1.deployment_status", "actively_investing", "Yes, I am"),
    );
    await say(
      "And on cheque sizes, what's the smallest you'd write?",
      "500 thousand",
      one("I2.cheque_min", 500_000, "500 thousand"),
    );
    await say(
      "And your typical cheque?",
      "My typical check size is about 3 million",
      one(
        "I2.cheque_typical",
        3_000_000,
        "My typical check size is about 3 million",
      ),
    );
    // Held for their yes (D-OWN-3): figures are read back.
    expect(world.recordedValue("I2.cheque_min")).toBeUndefined();
    await say(
      "So your smallest cheque is 500 thousand and your typical about 3 million, is that right?",
      "Yep, that's very correct.",
      EMPTY,
    );
    expect(world.recordedValue("I0.hq_country")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [US?.nodeId],
    });
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
    expect(world.recordedValue("I2.cheque_min")).toBeDefined();
    expect(world.recordedValue("I2.cheque_typical")).toBeDefined();
  });
});

describe("7. a city they name is saved as its country, typed and spoken", () => {
  const TYPED: ConversationLine = {
    ...DUPLEX,
    voiceSessionId: `typed:${SESSION}`,
  };
  it.each([
    ["Qatar", "We're in Doha right now", "QA", DUPLEX],
    ["United Arab Emirates", "Our office is in Dubai", "AE", DUPLEX],
    ["Nigeria", "Lagos", "NG", TYPED],
    ["United States", "San Francisco", "US", TYPED],
    ["United Kingdom", "London, England", "GB", DUPLEX],
  ] as const)('%s from "%s"', async (value, quote, iso, line) => {
    const { world, readings, conversation } = duplexWorld("I0.hq_country");
    readings.push({
      answers: [
        {
          stepKey: "I0.hq_country",
          value,
          quote,
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
      "Where is your firm based?",
      line === TYPED ? "I0.hq_country" : undefined,
    );
    await conversation.said?.(line, "PERSON", quote);
    await conversation.flush?.(line);
    expect(world.recordedValue("I0.hq_country")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [countryOfIso(iso)?.nodeId],
    });
  });

  it("the reader is told to give the country for a city", () => {
    const reader = createDefaultPromptRegistry().getActive(
      "ONBOARDING_TRANSCRIPT_READER",
    ).definition.template;
    expect(reader).toContain("Doha");
    expect(reader).toContain("give the country");
  });
});
