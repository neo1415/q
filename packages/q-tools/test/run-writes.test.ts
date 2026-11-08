import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  committedWrite,
  createOnboardingTools,
  createQToolExecutor,
  createQToolRegistry,
  createRunWriteLedger,
  type OnboardingToolPort,
} from "../src/index.js";
import { actorA, contextFor, planFor, USER_A } from "./support.js";

/**
 * Batch 14 (W1, instant writes): the executor notes the runs whose tools
 * committed a write, from the tool's classification, so the run's
 * completed event can say `dataChanged`. A read, a screen action and an
 * action that did not happen are not writes.
 */

function ownPlan(): PermittedContextPlan {
  const plan = planFor(actorA, "GENERAL_QUESTION", [
    { kind: "OWN_ONBOARDING", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) => ({
      ...scope,
      filter: { ...scope.filter, userId: actorA.userId },
    })),
  };
}

const port: OnboardingToolPort = {
  ownerUserId: USER_A,
  state: () =>
    Promise.resolve({
      journey: "investor",
      currentStepKey: "I0.investor_type",
      canComplete: false,
      completed: false,
      steps: [],
      checks: [],
    }),
  recommend: () => Promise.resolve([]),
  accept: () => Promise.resolve([]),
  finish: () => Promise.resolve({ completed: false, missing: [] }),
  correct: () => Promise.resolve([]),
  setAside: () => Promise.resolve([]),
  confirmAsStated: () => Promise.resolve([]),
  record: (answers) =>
    Promise.resolve(
      answers.map((a) => ({
        stepKey: a.stepKey,
        outcome: "COMMITTED" as const,
        recorded: String(a.value),
      })),
    ),
};

const call = (name: string, args: unknown) => ({
  callId: "call_1",
  name,
  arguments: args,
});

function outcome(
  classification: QToolCallOutcome["classification"],
  data: unknown,
  status: QToolCallOutcome["status"] = "SUCCEEDED",
): QToolCallOutcome {
  return {
    callId: "c",
    toolName: "t",
    toolVersion: 1,
    classification,
    status,
    failureCode: null,
    sensitivity: null,
    result: { ok: true, data },
    latencyMs: 1,
  };
}

describe("the runs whose tools wrote (batch 14)", () => {
  it("a run where a write executed is noted; a read-only run is not", async () => {
    const writes = createRunWriteLedger();
    const tools = createQToolExecutor({
      registry: createQToolRegistry(createOnboardingTools(port)),
      writes,
    });
    const context = contextFor(actorA, ownPlan());
    const read = await tools.execute(call("get_onboarding_state", {}), {
      ...context,
      runId: "run-read" as never,
    });
    expect(read.status).toBe("SUCCEEDED");
    const wrote = await tools.execute(
      call("record_answers", {
        answers: [
          { stepKey: "I0.investor_type", value: "angel", quote: "an angel" },
        ],
      }),
      context,
    );
    expect(wrote.status).toBe("SUCCEEDED");
    expect(writes.take("run-read")).toBe(false);
    expect(writes.take(context.runId)).toBe(true);
    // Taken once: the entry is dropped with the run's end.
    expect(writes.take(context.runId)).toBe(false);
  });

  it("decides from the classification: reads, screen actions, refusals and actions not done are not writes", () => {
    expect(committedWrite(outcome("SIDE_EFFECT", { status: "DONE" }))).toBe(
      true,
    );
    expect(committedWrite(outcome("READ_ONLY", { items: [] }))).toBe(false);
    expect(committedWrite(outcome("ANALYTICAL", {}))).toBe(false);
    expect(
      committedWrite(
        outcome("SIDE_EFFECT", {
          status: "SCREEN_WILL_DO_IT",
          clientAction: { kind: "SET_THEME", theme: "dark" },
        }),
      ),
    ).toBe(false);
    expect(
      committedWrite(outcome("SIDE_EFFECT", { status: "NOT_DONE", says: "" })),
    ).toBe(false);
    expect(committedWrite(outcome("SIDE_EFFECT", {}, "DENIED"))).toBe(false);
  });

  it("stays bounded", () => {
    const writes = createRunWriteLedger({ maxRuns: 2 });
    const done = outcome("SIDE_EFFECT", { status: "DONE" });
    writes.note("a", done);
    writes.note("b", done);
    writes.note("c", done);
    expect(writes.take("a")).toBe(false);
    expect(writes.take("c")).toBe(true);
  });
});
