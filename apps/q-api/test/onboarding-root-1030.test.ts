import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_CURRENT } from "@capital-q/investor-onboarding";
import { createLogger } from "@capital-q/observability";
import { ActorContextSchema } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createOnboardingConversation,
  keysFromIds,
  type ConversationLine,
} from "../src/voice/onboarding-conversation.js";
import { plainStepLabel, SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";
import { investorSession } from "./interviewer-fixtures.js";

/**
 * Live recheck 2026-10-30 (production 4d71bcf74, three fresh accounts).
 * No live model: the reading is a fake that answers as a model would from
 * what it is shown.
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

function withThread(world: ReturnType<typeof investorSession>) {
  const thread: { role: "PERSON" | "Q"; text: string; createdAt: string }[] =
    [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : (input as Request).url,
    );
    if (/\/turns(\/steps)?$/.test(url.pathname)) {
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { turns: { role: "PERSON" | "Q"; text: string }[] };
        const at = new Date().toISOString();
        thread.push(...body.turns.map((t) => ({ ...t, createdAt: at })));
        return Response.json({ written: true }, { status: 201 });
      }
      return Response.json({ items: thread });
    }
    return world.fetch(input, init);
  };
  return fetch;
}

const call = (): ConversationLine => ({
  voiceSessionId: "1200506d-494e-4a34-be3a-681e50b9c208",
  actor,
  accessToken: "eyPRIVATE.NEVER-EMITTED.bearer",
  onboarding: {
    sessionId: "f0000000-0000-4000-8000-000000000010",
    journeyType: "investor",
  },
});

describe("Class C: a reader sees option labels with opaque ids, never keys", () => {
  it('"We prefer to follow a lead": the reader is shown o-ids and labels, and its o-id saves co_invest', async () => {
    const world = investorSession({
      currentStepKey: "I2.investment_role",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Noordlicht Partners",
      },
    });
    const shown: string[] = [];
    const reader: OnboardingTranscriptReader = {
      read: (input) => {
        const role = input.steps.find(
          (s) => s.stepKey === "I2.investment_role",
        );
        shown.push(role?.options ?? "");
        // The label "Co-invest alongside a lead" is what "follow a lead"
        // means; the model answers with that option's id.
        const id = /(o\d+): Co-invest alongside a lead/u.exec(
          role?.options ?? "",
        )?.[1];
        return Promise.resolve({
          answers:
            id === undefined
              ? []
              : [
                  {
                    stepKey: "I2.investment_role",
                    value: [id],
                    quote: "We prefer to follow a lead",
                    ownWords: false,
                  },
                ],
          declined: [],
        });
      },
    };
    const conversation = createOnboardingConversation({
      apiBaseUrl: "http://api.test",
      fetch: withThread(world),
      logger,
      readAfterMs: 5,
      reader,
    });
    const line = call();
    conversation.heard(line, [
      { role: "Q", text: "What role do you usually take in a round?" },
      { role: "USER", text: "We prefer to follow a lead" },
    ]);
    await conversation.ended(line);

    expect(shown[0]).toMatch(
      /^o1: Lead rounds; o2: Co-invest alongside a lead; o3: Follow in later rounds/u,
    );
    // No key reaches the model as a word.
    expect(shown[0]).not.toMatch(/\b(lead|co_invest|follow):/u);
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["co_invest"],
    });
  });

  it("ids map back to keys; anything else is left as the reader gave it", () => {
    const ids = new Map([
      ["o1", "lead"],
      ["o2", "co_invest"],
    ]);
    expect(keysFromIds("o2", ids)).toBe("co_invest");
    expect(keysFromIds(["o1", "O2 "], ids)).toEqual(["lead", "co_invest"]);
    expect(keysFromIds("Uzbekistan", ids)).toBe("Uzbekistan");
    expect(keysFromIds(42, ids)).toBe(42);
    expect(keysFromIds("o1", undefined)).toBe("o1");
  });
});

describe("internal question text never names a step to the person", () => {
  it("every step's plain label is never its question or its key", () => {
    for (const definition of [
      FOUNDER_DEFINITION_CURRENT,
      INVESTOR_DEFINITION_CURRENT,
    ]) {
      for (const step of definition.steps) {
        const label = plainStepLabel(step.stepKey);
        expect(label, step.stepKey).not.toBe(step.stepKey);
        expect(label, step.stepKey).not.toBe(SPOKEN_QUESTIONS[step.stepKey]);
        if (step.configuration.prompt.trim().endsWith("?")) {
          expect(label, step.stepKey).not.toBe(step.configuration.prompt);
        }
      }
    }
    expect(plainStepLabel("F9.vision")).toBe("Our Vision");
  });
});
