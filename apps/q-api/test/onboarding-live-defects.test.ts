import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { countryOfIso } from "@capital-q/taxonomy/countries";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { RecordOnboardingAnswersInputSchema } from "@capital-q/q-tools";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { codeReading } from "../src/voice/code-reading.js";
import {
  withoutAnsweredQuestions,
  withoutUnbackedSaveClaims,
} from "../src/voice/onboarding-flow.js";
import { quickAcknowledgement } from "../src/voice/quick-acknowledgement.js";
import {
  branchStepKeys,
  createOnboardingPort,
  proposalPrerequisites,
  verbatimOptionIn,
} from "../src/voice/onboarding-port.js";
import { SPOKEN_QUESTIONS } from "../src/voice/step-copy.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/** Live re-run on release Z (2026-10-16), each defect pinned. */

const stepOf = (key: string) =>
  FOUNDER_DEFINITION_CURRENT.steps.find((s) => s.stepKey === key);

describe("an answered question is never asked again, however it is worded", () => {
  it("cuts the re-ask out of a grouped confirmation, keeping the confirmation", () => {
    const state = {
      steps: [
        {
          stepKey: "F1.description",
          question:
            SPOKEN_QUESTIONS["F1.description"] ??
            "In a sentence or two, what does the company do?",
          status: "ANSWERED",
        },
      ],
    } as never;
    const out = withoutAnsweredQuestions(
      "Quillmark Health, four pilots and the raise are saved. Is that right—and, first, in a sentence or two, what does the company do?",
      state,
      SPOKEN_QUESTIONS,
    );
    expect(out).not.toMatch(/what does the company do/i);
    expect(out).toMatch(/Is that right\?$/);
  });
});

describe("a choice named by its own label is their answer", () => {
  it("'first revenue only' is revenue_status early, decided by code", () => {
    expect(
      verbatimOptionIn(
        stepOf("F5.revenue_status"),
        "we have pilots running and first revenue only",
      ),
    ).toBe("early");
  });

  it("a one-word label or two labels at once are not decided by code", () => {
    expect(verbatimOptionIn(stepOf("F1.stage"), "we are seed")).toBeNull();
    expect(
      verbatimOptionIn(
        stepOf("F5.signal"),
        "pilots running and paying customers",
      ),
    ).toBeNull();
  });
});

describe("a deck's pilots wait on the signal question, which is asked first", () => {
  it("reads the steps a branching depends on", () => {
    expect(branchStepKeys(stepOf("F5.pilots")?.branching)).toEqual([
      "F1.stage",
      "F5.signal",
    ]);
  });

  it("the unanswered signal step is what stands between the person and the pilots proposal", () => {
    expect(
      proposalPrerequisites({
        pending: ["F5.pilots", "F6.currency"],
        eligible: new Set(["F1.stage", "F5.signal", "F6.currency"]),
        answered: new Set(["F1.stage"]),
        stepOf,
      }),
    ).toEqual(["F5.signal"]);
  });
});

describe("a question about their own upload is answered, never handed to a look-up", () => {
  it("'what did you find in the deck?' starts no research and no hand-over", async () => {
    const actor = ActorContextSchema.parse({
      userId: "b0000000-0000-4000-8000-000000000001",
      tenantId: "c0000000-0000-4000-8000-000000000001",
      actorType: "HUMAN",
    });
    const firewall: ContextFirewallPort = {
      plan: () =>
        Promise.resolve({
          outcome: "AUTHORISED",
          plan: {
            tenantId: actor.tenantId,
            actor: { userId: actor.userId },
            purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
            subjects: [],
            scopes: [
              {
                kind: "OWN_ONBOARDING",
                filter: { tenantId: actor.tenantId, userId: actor.userId },
                sensitivity: "CONFIDENTIAL",
              },
            ],
            maxSensitivity: "CONFIDENTIAL",
          } as unknown as PermittedContextPlan,
        }),
    };
    const seen: string[] = [];
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        seen.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({
              reply: "Your deck says four pilots. Is that right?",
              asking: null,
            }),
          },
        });
      },
    } as unknown as ModelGateway;
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.description",
    });
    const said = "I've uploaded our deck. What did you find in it?";
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger: createLogger(
        { serviceName: "q-api-test", environment: "test" },
        { level: "silent" },
      ),
      delegation: readerOf(reading({ lookup: "What did you find in it?" })),
      researchAvailable: true,
    }).turn({ ...turn(world, said), actor });
    expect(outcome.researching).toBeNull();
    expect(outcome.reply).not.toMatch(/proper look|research it with you/i);
    expect(seen.join("\n")).not.toContain("A look-up will run");
  });
});

describe("live latency run on release AA (2026-10-16)", () => {
  it("'US dollars.' under 'how much are you raising?' states the open currency step", () => {
    const read = codeReading({
      utterance: "US dollars.",
      asked: stepOf("F6.target_amount"),
      openChoices: [stepOf("F6.currency"), stepOf("F6.instrument")].filter(
        (s) => s !== undefined,
      ),
      pendingCount: 0,
    });
    expect([...(read?.stated ?? [])]).toEqual(["F6.currency"]);
  });

  it("a bare figure after Q moved on answers the amount asked just before", () => {
    const read = codeReading({
      utterance: "1200000",
      asked: stepOf("F6.currency"),
      askedBefore: stepOf("F6.target_amount"),
      pendingCount: 0,
    });
    expect([...(read?.stated ?? [])]).toEqual(["F6.target_amount"]);
  });

  it("never 'saved' when nothing was committed this turn", () => {
    const out = withoutUnbackedSaveClaims(
      "Veridia Water's site is noted. And $1,200,000 is saved for the raise. Which currency are you raising in?",
      false,
    );
    expect(out).not.toMatch(/saved for the raise|is noted/);
    expect(out).toMatch(/^I haven't saved that yet\./);
    expect(out).toMatch(/Which currency are you raising in\?$/);
    expect(withoutUnbackedSaveClaims("Stage: Seed is saved. Next?", true)).toBe(
      "Stage: Seed is saved. Next?",
    );
    expect(
      withoutUnbackedSaveClaims("Your website is already saved. Next?", false),
    ).toBe("Your website is already saved. Next?");
  });

  it("a read-back keeps their words without a doubled full stop", () => {
    expect(
      quickAcknowledgement({
        results: [
          {
            stepKey: "F1.description",
            outcome: "COMMITTED",
            recorded: "Water units for clinics.",
          },
        ],
        labelOf: () => "What the company does",
        next: { question: "What stage is the company at?", optional: false },
        turnIndex: 0,
      }),
    ).not.toContain("..");
  });
});

describe("live acceptance on AF (2026-10-16)", () => {
  it("'Based in Uganda' is Uganda, never a bare 'Somewhere else' (founder v8: any country)", async () => {
    // v1-v7 offered twenty countries and "Somewhere else" with their words;
    // v8 chooses the country from the geography taxonomy (every ISO
    // country), so Uganda is recorded as Uganda.
    const uganda = countryOfIso("UG")?.nodeId ?? "";
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.country",
      recorded: { "F0.intent": "raising_now" },
      taxonomy: { uganda },
    });
    const said = "Based in Uganda.";
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: "b0000000-0000-4000-8000-000000000001",
      personTurns: [said],
      authority: () => Promise.resolve(reading({ stated: ["F1.country"] })),
    });
    await port.record([
      {
        stepKey: "F1.country",
        value: "Uganda",
        quote: "Based in Uganda",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(world.recordedValue("F1.country")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [uganda],
    });
  });

  it("a place no country holds keeps their words, never a made-up country", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.country",
      recorded: { "F0.intent": "raising_now" },
    });
    const said = "Somewhere on the moon.";
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: "b0000000-0000-4000-8000-000000000001",
      personTurns: [said],
      authority: () => Promise.resolve(reading({ stated: ["F1.country"] })),
    });
    await port.record([
      {
        stepKey: "F1.country",
        value: "the moon",
        quote: "Somewhere on the moon",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(world.recordedValue("F1.country")).toMatchObject({ type: "TEXT" });
  });

  it("a long answer of thirteen facts, with a two-letter quote, is a valid call", () => {
    const answers = Array.from({ length: 13 }, (_, i) => ({
      stepKey: `I2.step_${String(i)}`,
      value: "x",
      quote: i === 0 ? "GP" : "their words",
    }));
    expect(
      RecordOnboardingAnswersInputSchema.safeParse({ answers }).success,
    ).toBe(true);
  });
});
