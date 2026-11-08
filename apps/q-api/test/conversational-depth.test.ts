import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { OnboardingState } from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import {
  CONVERSATIONAL_DEPTH,
  isPlaybackLine,
  playbackLine,
  topicOf,
} from "../src/voice/conversational-depth.js";
import {
  briefOf,
  createOnboardingConversation,
} from "../src/voice/onboarding-conversation.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { coverageProfileFor } from "../src/voice/onboarding-port.js";
import { createTypedOnboarding } from "../src/voice/typed-onboarding.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * DECISIONS 81 (docs/specs/onboarding/CONVERSATIONAL-DEPTH.md): Q converses
 * like a skilled interviewer. What code owns: a topic's answers are played
 * back before they are saved, a correction replays the corrected version,
 * strength and preference steps offer their choices, and one "why" a topic
 * -- never an interrogation loop.
 */
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);
const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000081",
  tenantId: "c0000000-0000-4000-8000-000000000081",
  actorType: "HUMAN",
});
const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000081",
};
const ROLE = "I2.investment_role";

type Reply = {
  reply: string;
  asking?: string | null;
  probing?: string | null;
};
type Reading = Awaited<ReturnType<OnboardingTranscriptReader["read"]>>;

function depthWorld(options: {
  readonly readings: Reading[];
  readonly script: readonly Reply[];
}) {
  const world = investorSession({
    currentStepKey: ROLE,
    subject: FIRM,
    recorded: {
      "I0.investor_type": "angel",
      "I0.organisation_name": "Harmattan Angels",
    },
  });
  const readings = [...options.readings];
  const reader: OnboardingTranscriptReader = {
    read: () =>
      Promise.resolve(
        readings.length > 1
          ? (readings.shift() ?? null)
          : (readings[0] ?? null),
      ),
  };
  const conversation = createOnboardingConversation({
    apiBaseUrl: "http://api.test",
    fetch: world.fetch,
    logger,
    readAfterMs: 5,
    reader,
    recommendations: world.recommendations,
    depth: CONVERSATIONAL_DEPTH,
  });
  let index = 0;
  const gateway = {
    execute: () => {
      const next = options.script[Math.min(index, options.script.length - 1)];
      index += 1;
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            reply: next?.reply ?? "",
            asking: next?.asking ?? null,
            readBack: false,
            probing: next?.probing ?? null,
          },
        },
      });
    },
  } as unknown as ModelGateway;
  const typed = createTypedOnboarding({
    conversation,
    gateway,
    delegation: readerOf(reading({})),
    recommendations: world.recommendations,
    depth: CONVERSATIONAL_DEPTH,
    logger,
  });
  const say = async (words: string) => {
    const outcome = await typed.turn({ ...turn(world, words), actor });
    if (outcome === null) throw new Error("the typed path declined the turn");
    return outcome;
  };
  return { world, say };
}

const ROLE_SAID = (value: string[], quote: string): Reading => ({
  answers: [{ stepKey: ROLE, value, quote, ownWords: false }],
  declined: [],
});
const NOTHING: Reading = { answers: [], declined: [] };

const SAID = (
  items: readonly (readonly [string, string | number | string[], string])[],
): Reading => ({
  answers: items.map(([stepKey, value, quote]) => ({
    stepKey,
    value,
    quote,
    ownWords: false,
  })),
  declined: [],
});
const MIN = "I2.cheque_min";
const MAX = "I2.cheque_max";

describe("D82: a clear typed answer saves at once (D77)", () => {
  it("their clear answer is saved, with no playback", async () => {
    const { world, say } = depthWorld({
      readings: [NOTHING, ROLE_SAID(["lead"], "We lead rounds")],
      script: [
        { reply: "Do you usually lead rounds?", asking: ROLE },
        { reply: "Clear. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    const moved = await say("We lead rounds.");
    expect(moved.reply).toBe("Clear. Where do you invest?");
    expect(world.recordedValue(ROLE)).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead"],
    });
  });

  it("run 9 J1: a dense line with the firm's name saves the name and what needs it", async () => {
    const world = investorSession({
      currentStepKey: "I0.organisation_name",
      setUpBy: ["I0.organisation_name"],
      subject: FIRM,
      recorded: { "I0.investor_type": "angel" },
    });
    const reader: OnboardingTranscriptReader = {
      read: () =>
        Promise.resolve(
          SAID([
            [
              "I0.organisation_name",
              "Kestrel Bay Capital",
              "Kestrel Bay Capital",
            ],
            ["I2.stages", ["seed"], "seed"],
          ]),
        ),
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: world.fetch,
      logger,
      readAfterMs: 5,
      reader,
      recommendations: world.recommendations,
      depth: CONVERSATIONAL_DEPTH,
    });
    const line = {
      voiceSessionId: "typed:11111111-1111-4111-8111-111111111111",
      actor,
      accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
      onboarding: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        journeyType: "investor" as const,
      },
    };
    await conversation.said?.(
      line,
      "Q",
      "What's your firm called?",
      "I0.organisation_name",
    );
    await conversation.said?.(
      line,
      "PERSON",
      "We're Kestrel Bay Capital, we back seed companies.",
    );
    await conversation.flush?.(line);
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Kestrel Bay Capital",
    });
    expect(world.recordedValue("I2.stages")).toBeDefined();
  });
});

describe("D82: what waits for their yes is played back once a topic, together", () => {
  it("one value waiting gets no playback of its own", async () => {
    const { say } = depthWorld({
      readings: [NOTHING, SAID([[MIN, 250000, "from 250k"]])],
      script: [
        { reply: "What's your smallest cheque?", asking: MIN },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    const moved = await say("From 250k.");
    expect(moved.reply).toBe("Thanks. Where do you invest?");
  });

  it("two values waiting: one playback that carries both, one sentence, saved on their yes", async () => {
    const { world, say } = depthWorld({
      readings: [
        NOTHING,
        SAID([
          [MIN, 250000, "from 250k"],
          [MAX, 1000000, "up to a million"],
        ]),
        NOTHING,
      ],
      script: [
        { reply: "What cheque range do you write?", asking: MIN },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    const moved = await say("From 250k up to a million.");
    expect(moved.reply).toMatch(/^Thanks\. Let me get this right: /u);
    expect(moved.reply).toMatch(/250/u);
    expect(moved.reply).toMatch(/1,?000,?000|1 million/u);
    expect(moved.reply).toMatch(/, is that right\?$/u);
    // Never a bare "Is that right?" sentence.
    expect(moved.reply).not.toMatch(/\. Is that right\?/u);
    expect(world.recordedValue(MIN)).toBeUndefined();
    await say("Yes.");
    expect(world.recordedValue(MIN)).toEqual({
      type: "RANGE",
      value: "250000",
    });
    expect(world.recordedValue(MAX)).toEqual({
      type: "RANGE",
      value: "1000000",
    });
  });

  it("a correction replays the corrected version, never the old one", async () => {
    const { world, say } = depthWorld({
      readings: [
        NOTHING,
        SAID([
          [MIN, 250000, "from 250k"],
          [MAX, 1000000, "up to a million"],
        ]),
        SAID([[MIN, 300000, "300k"]]),
      ],
      script: [
        { reply: "What cheque range do you write?", asking: MIN },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
        { reply: "Got it. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    await say("From 250k up to a million.");
    const replay = await say("The minimum is 300k, not 250k.");
    expect(replay.reply).toMatch(/^Thanks\. So: /u);
    expect(replay.reply).toMatch(/300/u);
    expect(replay.reply).not.toMatch(/250/u);
    expect(replay.reply).toMatch(/, is that right\?$/u);
    expect(world.recordedValue(MIN)).toBeUndefined();
  });
});

describe("D82 #5: asks are counted running, never across other turns", () => {
  it("run 9 J3: a needed step asked again later is asked, not left for now", async () => {
    // The fixture's v1 journey has no website step; the stages stand in.
    const WEBSITE = "I3.geography";
    const { say } = depthWorld({
      readings: [NOTHING],
      script: [
        { reply: "Where do you invest?", asking: WEBSITE },
        { reply: "Which stages do you invest in?", asking: "I2.stages" },
        { reply: "And where do you invest?", asking: WEBSITE },
        {
          reply: "Capital Q matches you by it. Where do you invest?",
          asking: WEBSITE,
        },
      ],
    });
    await say("Hello.");
    await say("We're a seed fund.");
    await say("Pre-seed and seed.");
    const fourth = await say("I'd rather not give it.");
    expect(fourth.reply).not.toMatch(/let's leave it for now/u);
    expect(fourth.asking?.stepKey).toBe(WEBSITE);
  });
});

describe("D81 #2: why once a topic, never a loop", () => {
  it("a second why for the same topic is taken out and the next question asked", async () => {
    const { say } = depthWorld({
      readings: [NOTHING],
      script: [
        {
          reply: "Why lead rather than follow?",
          asking: ROLE,
          probing: ROLE,
        },
        {
          reply: "Understood. And why lead, again?",
          asking: ROLE,
          probing: ROLE,
        },
      ],
    });
    const first = await say("We lead rounds.");
    expect(first.reply).toMatch(/Why lead rather than follow\?/u);
    const second = await say("Speed, mostly.");
    expect(second.reply).not.toMatch(/why lead, again/u);
    expect(second.asking?.stepKey).not.toBe(ROLE);
  });

  it("their why is kept as the topic's private note", async () => {
    const { world, say } = depthWorld({
      readings: [ROLE_SAID(["lead"], "We lead rounds"), NOTHING],
      script: [
        { reply: "Why lead rather than follow?", asking: ROLE, probing: ROLE },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("We lead rounds.");
    await say("Speed: we can move first.");
    // Kept once the answer is on the record: by the next turn at the latest.
    await say("West Africa.");
    expect(world.recordedValue(ROLE)).toBeDefined();
    expect(world.recordedNote(ROLE)).toBe("Speed: we can move first.");
  });
});

describe("D81 #3: choices to react to", () => {
  const labelOf = (key: string) =>
    coverageProfileFor("investor").fields[key]?.label;

  it("the first ask of a strength step offers its choices", () => {
    const said = finishingLine(
      "investor",
      {
        completed: false,
        missing: [{ stepKey: "I6.green_flag_strength", question: "How firm?" }],
      },
      {
        labelOf,
        questionOf: () => "Are those musts, or more of a preference?",
        choicesOf: () => ["Must match", "Strong preference", "Nice to have"],
      },
    );
    expect(said?.reply).toMatch(
      /Are those musts, or more of a preference: Must match, Strong preference or Nice to have\?$/u,
    );
  });

  it("the checklist marks strength steps to offer their choices", () => {
    const state = {
      journey: "investor",
      currentStepKey: null,
      canComplete: false,
      completed: false,
      checks: [],
      next: [],
      steps: [
        {
          stepKey: "I3.geography_strength",
          question: "How firm is that?",
          kind: "ONE_OF",
          required: true,
          status: "OPEN",
          value: null,
          options: [
            { key: "must", label: "Must match" },
            { key: "strong", label: "Strong preference" },
          ],
        },
      ],
    } as unknown as OnboardingState;
    expect(briefOf(state)).toMatch(
      /offer these choices to react to; a mix is an answer/u,
    );
  });
});

describe("the playback line itself", () => {
  it("is labels and values, one question, and code recognises it", () => {
    const first = playbackLine(["Role in a round: Lead rounds"], false);
    expect(first).toBe(
      "Let me get this right: Role in a round: Lead rounds, is that right?",
    );
    expect(first.match(/\?/gu) ?? []).toHaveLength(1);
    expect(isPlaybackLine(first)).toBe(true);
    expect(isPlaybackLine(playbackLine(["A: b"], true))).toBe(true);
    expect(isPlaybackLine("Is that right?")).toBe(false);
  });

  it("topics follow the profile: deployment is its own topic, apart from the cheque", () => {
    expect(topicOf("investor", "I1.deployment_status")).not.toBe(
      topicOf("investor", "I2.cheque_min"),
    );
    expect(topicOf("investor", "I3.sectors_avoid")).toBe("theme:off_the_table");
  });
});

/**
 * e2e run 10 (production batch 15): "Are you actively writing cheques at
 * the moment…?" asked four times with other steps between; the playback
 * mixed "Deploying now" with the cheque and left out the saved minimum.
 */
describe("run 10 (a): every ask counts, interleaved or not", () => {
  it("the third ask gives its reason and choices once; the fourth leaves it for now", async () => {
    const DEPLOY = "I1.deployment_status";
    const { say } = depthWorld({
      readings: [NOTHING],
      script: [
        { reply: "Are you actively investing right now?", asking: DEPLOY },
        { reply: "Which stages do you invest in?", asking: "I2.stages" },
        { reply: "Are you writing cheques at the moment?", asking: DEPLOY },
        { reply: "Where do you invest?", asking: "I3.geography" },
        { reply: "And are you deploying now?", asking: DEPLOY },
        { reply: "Thanks. Which sectors?", asking: "I3.sectors" },
        { reply: "Are you actively investing?", asking: DEPLOY },
      ],
    });
    const replies: string[] = [];
    for (const words of [
      "Hello.",
      "Seed.",
      "Pre-seed and seed.",
      "West Africa.",
      "Fintech.",
      "Climate too.",
      "Yes.",
    ]) {
      replies.push((await say(words)).reply);
    }
    // Third ask (fifth reply): its reason and its choices, once.
    expect(replies[4]).toMatch(
      /^Just so I can match you well, I need this one: /u,
    );
    expect(replies[4]).toMatch(/ or [^?]+\?$/u);
    // Fourth ask (seventh reply): left for now, never asked a fifth way.
    expect(replies[6]).toMatch(/let's leave it for now/u);
  });
});

describe("run 10 (b): a playback is one topic, its full set", () => {
  it("the cheque's saved minimum beside its waiting maximum, without deployment", async () => {
    const { world, say } = depthWorld({
      readings: [
        NOTHING,
        SAID([
          [MAX, 1000000, "up to a million"],
          ["I1.deployment_status", "actively_investing", "actively investing"],
        ]),
      ],
      script: [
        { reply: "What's your largest cheque?", asking: MAX },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    world.record(MIN, { type: "RANGE", value: "250000" });
    await say("Hello.");
    const moved = await say("Up to a million, and we're actively investing.");
    expect(moved.reply).toMatch(/Let me get this right: /u);
    expect(moved.reply).toMatch(/250/u);
    expect(moved.reply).toMatch(/1,?000,?000|1 million/u);
    expect(moved.reply).not.toMatch(/Deploying|deploying|Actively investing/u);
  });
});
