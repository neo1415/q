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

describe("D81 #4: a topic is played back before it is saved", () => {
  it("held while the topic is open, played back on moving on, saved on their yes", async () => {
    const { world, say } = depthWorld({
      readings: [NOTHING, ROLE_SAID(["lead"], "We lead rounds"), NOTHING],
      script: [
        {
          reply: "Do you usually lead rounds, or invest alongside a lead?",
          asking: ROLE,
        },
        { reply: "Clear. Where do you invest?", asking: "I3.geography" },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    const moved = await say("We lead rounds.");
    // Not saved yet: held for their yes.
    expect(world.recordedValue(ROLE)).toBeUndefined();
    expect(moved.reply).toMatch(/^Clear\. Let me get this right: /u);
    expect(moved.reply).toMatch(/Lead rounds\. Is that right\?$/u);
    expect(moved.asking?.stepKey).toBe(ROLE);
    // Their yes saves exactly what was played back.
    await say("Yes.");
    expect(world.recordedValue(ROLE)).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead"],
    });
  });

  it("a correction replays the corrected version, never the old one", async () => {
    const { world, say } = depthWorld({
      readings: [
        NOTHING,
        ROLE_SAID(["lead"], "We lead rounds"),
        ROLE_SAID(["follow"], "we follow in later rounds"),
      ],
      script: [
        { reply: "Do you usually lead rounds?", asking: ROLE },
        { reply: "Clear. Where do you invest?", asking: "I3.geography" },
        { reply: "Got it. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("Hello.");
    await say("We lead rounds.");
    const replay = await say("Actually no, we follow in later rounds.");
    expect(replay.reply).toMatch(/^Thanks\. So: /u);
    expect(replay.reply).toMatch(/Follow in later rounds/u);
    expect(replay.reply).not.toMatch(/Lead rounds/u);
    expect(replay.reply).toMatch(/Is that right\?$/u);
    expect(world.recordedValue(ROLE)).toBeUndefined();
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

  it("their why is kept as the topic's private note once its answer is saved", async () => {
    const { world, say } = depthWorld({
      readings: [ROLE_SAID(["lead"], "We lead rounds"), NOTHING],
      script: [
        { reply: "Why lead rather than follow?", asking: ROLE, probing: ROLE },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
        { reply: "Thanks. Where do you invest?", asking: "I3.geography" },
      ],
    });
    await say("We lead rounds.");
    await say("Speed: we can move first.");
    await say("Yes.");
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
      "Let me get this right: Role in a round: Lead rounds. Is that right?",
    );
    expect(first.match(/\?/gu) ?? []).toHaveLength(1);
    expect(isPlaybackLine(first)).toBe(true);
    expect(isPlaybackLine(playbackLine(["A: b"], true))).toBe(true);
    expect(isPlaybackLine("Is that right?")).toBe(false);
  });

  it("topics follow the profile: deployment goes with the cheque", () => {
    expect(topicOf("investor", "I1.deployment_status")).toBe(
      topicOf("investor", "I2.cheque_min"),
    );
    expect(topicOf("investor", "I3.sectors_avoid")).toBe("theme:off_the_table");
  });
});
