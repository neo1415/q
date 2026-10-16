import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { withoutAnsweredQuestions } from "../src/voice/onboarding-flow.js";
import {
  branchStepKeys,
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
