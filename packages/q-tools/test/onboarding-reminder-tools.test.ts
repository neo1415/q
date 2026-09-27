import { describe, expect, it } from "vitest";

import {
  QClientActionToolResultSchema,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createOnboardingReminderTools,
  createQToolExecutor,
  createQToolRegistry,
  SetOnboardingRemindersInputSchema,
  type OnboardingRemindersPort,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * Setup reminders by text or voice (founder directive 2026-09-27): "remind
 * me later", "stop reminding me", "let's finish my setup". The model names
 * the tool; the authorize step and the owner-keyed port decide.
 */

function ownPlan(actor = actorA, owner = actor): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: owner.userId } }
        : scope,
    ),
  };
}

function harness(unfinished: "founder" | "investor" | null) {
  const chosen: { userId: string; choice: string }[] = [];
  const port: OnboardingRemindersPort = {
    choose: (actor: ActorContext, choice) => {
      chosen.push({ userId: actor.userId, choice });
      return Promise.resolve();
    },
    unfinished: () => Promise.resolve(unfinished),
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createOnboardingReminderTools(port)),
  });
  return { executor, chosen };
}

const call = (name: string, args: Record<string, unknown>) => ({
  callId: `c-${name}`,
  name,
  arguments: args,
});

describe("setup reminder tools", () => {
  it("takes only LATER or STOP", () => {
    expect(
      SetOnboardingRemindersInputSchema.safeParse({ choice: "LATER" }).success,
    ).toBe(true);
    expect(
      SetOnboardingRemindersInputSchema.safeParse({ choice: "NEVER_AGAIN" })
        .success,
    ).toBe(false);
    expect(
      SetOnboardingRemindersInputSchema.safeParse({
        choice: "STOP",
        userId: actorB.userId,
      }).success,
    ).toBe(false);
  });

  for (const choice of ["LATER", "STOP"] as const) {
    it(`records ${choice} for the person themselves`, async () => {
      const { executor, chosen } = harness("founder");
      const outcome = await executor.execute(
        call("set_onboarding_reminders", { choice }),
        contextFor(actorA, ownPlan()),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(chosen).toEqual([{ userId: actorA.userId, choice }]);
    });
  }

  it("NEGATIVE: never changes reminders from someone else's conversation", async () => {
    const { executor, chosen } = harness("founder");
    const outcome = await executor.execute(
      call("set_onboarding_reminders", { choice: "STOP" }),
      contextFor(actorA, ownPlan(actorA, actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(chosen).toEqual([]);
  });

  for (const journey of ["founder", "investor"] as const) {
    it(`continue_onboarding takes a ${journey} back to their own setup`, async () => {
      const { executor } = harness(journey);
      const outcome = await executor.execute(
        call("continue_onboarding", {}),
        contextFor(actorA, ownPlan()),
      );
      if (!outcome.result.ok) throw new Error("expected the tool to succeed");
      expect(
        QClientActionToolResultSchema.parse(outcome.result.data).clientAction,
      ).toEqual({ kind: "OPEN_SETUP", journey });
    });
  }

  it("continue_onboarding is not available when the setup is complete", async () => {
    const { executor } = harness(null);
    const outcome = await executor.execute(
      call("continue_onboarding", {}),
      contextFor(actorA, ownPlan()),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
  });
});
