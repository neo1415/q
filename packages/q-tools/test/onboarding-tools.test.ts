import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  createOnboardingTools,
  createQToolExecutor,
  createQToolRegistry,
  defineQTool,
  type OnboardingToolPort,
} from "../src/index.js";

import { actorA, actorB, contextFor, planFor, USER_A } from "./support.js";

/**
 * ADR 0016: the interview's tools run through the same registry and
 * executor as every Q tool. Asserted: the one write lane is admitted and
 * nothing beyond it; the tools are reachable only under the owner's own
 * OWN_ONBOARDING scope; and what the port reports is what the model gets.
 */

function ownPlan(
  actor = actorA,
  userIdInFilter: string = actor.userId,
): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_ONBOARDING", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) => ({
      ...scope,
      filter: { ...scope.filter, userId: userIdInFilter },
    })),
  };
}

function port(recorded: string[]): OnboardingToolPort {
  return {
    ownerUserId: USER_A,
    state: () =>
      Promise.resolve({
        journey: "investor",
        currentStepKey: "I0.investor_type",
        canComplete: false,
        completed: false,
        steps: [
          {
            stepKey: "I0.investor_type",
            question: "How do you invest?",
            kind: "ONE_OF",
            required: true,
            status: "OPEN",
            value: null,
            options: [{ key: "angel", label: "Angel investor" }],
          },
        ],
      }),
    recommend: () => Promise.resolve([]),
    accept: () => Promise.resolve([]),
    finish: () => Promise.resolve({ completed: false, missing: [] }),
    correct: () => Promise.resolve([]),
    setAside: () => Promise.resolve([]),
    record: (answers) => {
      recorded.push(...answers.map((a) => a.stepKey));
      return Promise.resolve(
        answers.map((a) => ({
          stepKey: a.stepKey,
          outcome: "COMMITTED" as const,
          recorded: String(a.value),
        })),
      );
    },
  };
}

const call = (name: string, args: unknown) => ({
  callId: "call_1",
  name,
  arguments: args,
});

describe("ADR 0016 · onboarding tools", () => {
  it("admits the own-record write lane and nothing beyond it", () => {
    expect(() =>
      createQToolRegistry(createOnboardingTools(port([]))),
    ).not.toThrow();
    const writer = createOnboardingTools(port([]))[1];
    if (writer === undefined) throw new Error("record_answers is missing");
    const approvalNeeded = defineQTool({
      ...writer,
      id: "test.send",
      providerName: "send_it",
      riskClass: "CONFIRM_REQUIRED",
      classification: "SIDE_EFFECT",
    });
    expect(() => createQToolRegistry([approvalNeeded])).toThrow();
  });

  it("records answers for the owner under their OWN_ONBOARDING scope", async () => {
    const recorded: string[] = [];
    const tools = createQToolExecutor({
      registry: createQToolRegistry(createOnboardingTools(port(recorded))),
    });
    const context = contextFor(actorA, ownPlan());

    const offered = await tools.offer(context);
    expect(offered.map((t) => t.definition.name).sort()).toEqual([
      "accept_recommendation",
      "confirm_and_finish",
      "correct_answer",
      "get_onboarding_state",
      "recommend",
      "record_answers",
      "set_aside",
    ]);

    const outcome = await tools.execute(
      call("record_answers", {
        answers: [
          { stepKey: "I0.investor_type", value: "angel", quote: "an angel" },
          {
            stepKey: "I0.organisation_name",
            value: "Zino Aviation",
            quote: "Zino Aviation",
          },
        ],
      }),
      context,
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(recorded).toEqual(["I0.investor_type", "I0.organisation_name"]);
  });

  it("is not offered without the scope, and refuses another person", async () => {
    const recorded: string[] = [];
    const tools = createQToolExecutor({
      registry: createQToolRegistry(createOnboardingTools(port(recorded))),
    });

    const noScope = contextFor(actorA, planFor(actorA, "GENERAL_QUESTION", []));
    expect(await tools.offer(noScope)).toEqual([]);

    // Someone else's run, with their own scope, against this session.
    const other = contextFor(actorB, ownPlan(actorB));
    const outcome = await tools.execute(
      call("record_answers", {
        answers: [
          { stepKey: "I0.investor_type", value: "angel", quote: "an angel" },
        ],
      }),
      other,
    );
    expect(outcome.status).toBe("DENIED");

    // A scope filtered to somebody else is not this person's scope.
    const forged = contextFor(actorA, ownPlan(actorA, actorB.userId));
    const refused = await tools.execute(
      call("record_answers", {
        answers: [
          { stepKey: "I0.investor_type", value: "angel", quote: "an angel" },
        ],
      }),
      forged,
    );
    expect(refused.status).toBe("DENIED");
    expect(recorded).toEqual([]);
  });
});
