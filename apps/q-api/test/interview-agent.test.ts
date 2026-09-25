import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * ADR 0016, milestone M1: one freeform turn → Q sees the whole state →
 * calls record_answers → several answers written → the reply is the
 * model's, written after the results. Deterministic doubles: the model's
 * tool calls are given; what the session holds is asserted.
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

/** The Context Firewall's plan for the owner: their OWN_ONBOARDING scope. */
function firewall(withScope = true): ContextFirewallPort {
  const plan = {
    tenantId: actor.tenantId,
    actor: { userId: actor.userId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: withScope
      ? [
          {
            kind: "OWN_ONBOARDING",
            filter: { tenantId: actor.tenantId, userId: actor.userId },
            sensitivity: "CONFIDENTIAL",
          },
        ]
      : [],
    maxSensitivity: "CONFIDENTIAL",
  } as unknown as PermittedContextPlan;
  return {
    plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }),
  };
}

type Scripted =
  | { readonly calls: readonly { name: string; arguments: unknown }[] }
  | { readonly reply: string; readonly asking?: string | null };

/** A model that says, round by round, what the script says; records what it saw. */
function model(script: readonly Scripted[]) {
  const seen: { tools: string[]; text: string }[] = [];
  let index = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
      readonly tools?: readonly { readonly name: string }[];
    }) => {
      seen.push({
        tools: (request.tools ?? []).map((t) => t.name),
        text: request.messages.map((m) => m.content).join("\n"),
      });
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (step !== undefined && "calls" in step) {
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: step.calls.map((c, i) => ({
              callId: `call_${String(index)}_${String(i)}`,
              name: c.name,
              arguments: c.arguments,
            })),
          },
        });
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({
            reply: step?.reply ?? "",
            asking: step?.asking ?? null,
          }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

describe("ADR 0016 · M1 · one freeform turn writes several answers", () => {
  it("records every answer the model placed, and replies after the results", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                { stepKey: "I0.investor_type", value: "Angel investor" },
                { stepKey: "I0.organisation_name", value: "Zino Aviation" },
                {
                  stepKey: "I1.deployment_status",
                  value: "actively_investing",
                },
              ],
            },
          },
        ],
      },
      { reply: "Good — pre-seed next?", asking: "I2.stages" },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({
      ...turn(
        world,
        "I'm an angel with Zino Aviation and I'm actively investing.",
      ),
      actor,
    });

    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "angel",
    });
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Zino Aviation",
    });
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
    expect(outcome.recorded).toEqual([
      "I0.investor_type",
      "I0.organisation_name",
      "I1.deployment_status",
    ]);
    expect(outcome.reply).toBe("Good — pre-seed next?");
    // The model saw the whole state, and the tool results before replying.
    expect([...(seen[0]?.tools ?? [])].sort()).toEqual([
      "accept_recommendation",
      "confirm_and_finish",
      "get_onboarding_state",
      "recommend",
      "record_answers",
    ]);
    expect(seen[0]?.text).toContain("I7.hard_exclusions");
    expect(seen[1]?.text).toContain("COMMITTED");
  });

  it("writes nothing on an opening: nothing was said", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [{ stepKey: "I0.investor_type", value: "angel" }],
            },
          },
        ],
      },
      { reply: "How do you invest?", asking: "I0.investor_type" },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({ ...turn(world, ""), actor });

    expect(seen[0]?.tools).toEqual(["get_onboarding_state"]);
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
    expect(outcome.recorded).toEqual([]);
    expect(outcome.asking?.stepKey).toBe("I0.investor_type");
  });

  it("offers no onboarding tool without the owner's scope", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [{ stepKey: "I0.investor_type", value: "angel" }],
            },
          },
        ],
      },
      { reply: "How do you invest?" },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(false),
      logger,
    });

    await agent.turn({ ...turn(world, "I'm an angel."), actor });

    expect(seen[0]?.tools).toEqual([]);
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
  });
});

describe("ADR 0016 · M2 · a question, an answer and a correction in one turn", () => {
  it("writes the answer and the correction, and the reply carries the answer to the question", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_typical",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Zino Aviation",
        "I1.deployment_status": "actively_investing",
        "I2.stages": "pre_seed",
        "I2.currency": "eur",
        "I2.cheque_min": "10000",
        "I2.cheque_max": "50000",
      },
    });
    const answer =
      "Pre-seed rounds are often EUR 500k to 2m. Typical cheque 25,000 and minimum 15,000 are on your record.";
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                { stepKey: "I2.cheque_typical", value: 25000 },
                { stepKey: "I2.cheque_min", value: 15000 },
              ],
            },
          },
        ],
      },
      { reply: answer, asking: "I2.investment_role" },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({
      ...turn(
        world,
        "Typically 25k. Actually, make the minimum 15k, not 10k. And what does a typical pre-seed round look like?",
      ),
      actor,
    });

    expect(world.recordedValue("I2.cheque_typical")).toEqual({
      type: "RANGE",
      value: "25000",
    });
    // The correction replaced the earlier answer.
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "15000",
    });
    expect(outcome.reply).toBe(answer);
    // What is still open after the writes reached the model before it replied.
    expect(seen[1]?.text).toContain("stillOpen");
  });
});

describe("ADR 0016 · M3 · a recommendation becomes an answer only on approval", () => {
  const SO_FAR = {
    "I0.investor_type": "angel",
    "I0.organisation_name": "Zino Aviation",
    "I1.deployment_status": "actively_investing",
  };
  const RECOMMENDED = ["gambling", "tobacco", "weapons"];

  it("holds Q's recommendation without writing, then writes exactly it on approval", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: SO_FAR,
    });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "recommend",
            arguments: {
              recommendations: [
                {
                  stepKey: "I7.hard_exclusions",
                  value: RECOMMENDED,
                  because: "Common exclusions for an aviation-focused angel.",
                },
              ],
            },
          },
        ],
      },
      { reply: "I'd hide gambling, tobacco and weapons. Shall I?" },
      {
        calls: [
          {
            name: "accept_recommendation",
            arguments: { stepKeys: ["I7.hard_exclusions"] },
          },
        ],
      },
      { reply: "Done." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const first = await agent.turn({
      ...turn(world, "Pick three for me that you think I wouldn't like."),
      actor,
    });
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
    expect(first.recorded).toEqual([]);

    const second = await agent.turn({
      ...turn(world, "Yes, go with those."),
      actor,
    });
    // The pending recommendation was in front of the model when it decided.
    expect(seen[2]?.text).toContain("pendingRecommendation");
    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: RECOMMENDED,
    });
    expect(second.recorded).toEqual(["I7.hard_exclusions"]);
  });

  it("writes nothing when there is no pending recommendation to approve", async () => {
    const world = investorSession({
      currentStepKey: "I7.avoid",
      recorded: SO_FAR,
    });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "accept_recommendation",
            arguments: { stepKeys: ["I7.avoid"] },
          },
        ],
      },
      { reply: "There was nothing pending." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({ ...turn(world, "Yes."), actor });

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    expect(outcome.recorded).toEqual([]);
    expect(seen[1]?.text).toContain("REJECTED");
  });
});

describe("ADR 0016 · M4 · finishing is checked by code, once", () => {
  it("completes nothing while a required answer is missing, and says which", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: { "I0.investor_type": "angel" },
    });
    const { gateway, seen } = model([
      { calls: [{ name: "confirm_and_finish", arguments: {} }] },
      { reply: "Not yet — stages first." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({
      ...turn(world, "That's all, finish it."),
      actor,
    });

    expect(outcome.navigate).toBeNull();
    expect(seen[1]?.text).toContain('"completed":false');
    expect(seen[1]?.text).toContain("I2.stages");
  });

  it("confirms the review and completes the journey when everything required is there", async () => {
    const { INVESTOR_DEFINITION_V1 } =
      await import("@capital-q/investor-onboarding");
    const required = Object.fromEntries(
      INVESTOR_DEFINITION_V1.steps
        .filter(
          (step) =>
            step.required && step.configuration.stepType !== "confirmation",
        )
        .map((step) => {
          const c = step.configuration;
          const value =
            c.stepType === "single_select" || c.stepType === "multi_select"
              ? (c.options[0]?.optionKey ?? "x")
              : c.stepType === "range"
                ? c.min
                : c.stepType === "reference_select"
                  ? "a0000000-0000-4000-8000-000000000099"
                  : "value";
          return [step.stepKey, value] as const;
        }),
    );
    const world = investorSession({
      currentStepKey: "I11.review",
      recorded: required,
    });
    const { gateway } = model([
      { calls: [{ name: "confirm_and_finish", arguments: {} }] },
      { reply: "You're all set." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
    });

    const outcome = await agent.turn({
      ...turn(world, "Yes, it's right."),
      actor,
    });

    expect(outcome.view.session.status).toBe("COMPLETED");
    expect(outcome.navigate).toBe("DISCOVER");
    expect(world.recordedValue("I11.review")).toEqual({
      type: "CONFIRMATION",
      confirmed: true,
    });
  });
});
