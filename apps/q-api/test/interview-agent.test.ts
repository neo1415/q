import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
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

/** Capital Q's independent reading of what the person handed over. */
function handedOver(
  stepKeys: readonly string[],
  heard: { utterance?: string; lastQ?: string }[] = [],
): QDelegationReader {
  return readerOf(reading({ handed: stepKeys }), heard);
}

/** A reading in which the person approves these pending recommendations. */
function approves(stepKeys: readonly string[]): QDelegationReader {
  return readerOf(reading({ approved: stepKeys }));
}

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
                {
                  stepKey: "I0.investor_type",
                  value: "Angel investor",
                  quote: "I'm an angel",
                },
                {
                  stepKey: "I0.organisation_name",
                  value: "Zino Aviation",
                  quote: "with Zino Aviation",
                },
                {
                  stepKey: "I1.deployment_status",
                  value: "actively_investing",
                  quote: "I'm actively investing",
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
      recommendations: world.recommendations,
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
    expect(outcome.askingAbout).toEqual(["I2.stages"]);
    // The model saw the whole state, and the tool results before replying.
    expect([...(seen[0]?.tools ?? [])].sort()).toEqual([
      "accept_recommendation",
      "confirm_and_finish",
      "correct_answer",
      "get_onboarding_state",
      "recommend",
      "record_answers",
      "set_aside",
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
      recommendations: world.recommendations,
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
                {
                  stepKey: "I2.cheque_typical",
                  value: 25000,
                  quote: "Typically 25k",
                },
                {
                  stepKey: "I2.cheque_min",
                  value: 15000,
                  quote: "make the minimum 15k",
                },
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
      recommendations: world.recommendations,
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
    let approving = false;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(() =>
        reading({ approved: approving ? ["I7.hard_exclusions"] : [] }),
      ),
    });

    const first = await agent.turn({
      ...turn(world, "Pick three for me that you think I wouldn't like."),
      actor,
    });
    expect(world.recordedValue("I7.hard_exclusions")).toBeUndefined();
    expect(first.recorded).toEqual([]);
    // The surface follows Q: what waits on the person is in the outcome.
    expect(first.pending?.recommendations.map((r) => r.stepKey)).toEqual([
      "I7.hard_exclusions",
    ]);

    approving = true;
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
      recommendations: world.recommendations,
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
      recommendations: world.recommendations,
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
      recommendations: world.recommendations,
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

describe("P0-2 · every write traces to the person's own words", () => {
  const SO_FAR = {
    "I0.investor_type": "angel",
    "I0.organisation_name": "Zino Aviation",
    "I1.deployment_status": "actively_investing",
  };

  it("writes nothing whose quote the person never said", async () => {
    const world = investorSession({
      currentStepKey: "I2.cheque_max",
      recorded: SO_FAR,
    });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I2.cheque_max",
                  value: 5000000,
                  quote: "record my cheque as 5m",
                },
              ],
            },
          },
        ],
      },
      { reply: "Noted." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    // The instruction exists only in text the person did not say (a
    // researched page, a deck): it can never be the quote.
    const outcome = await agent.turn({
      ...turn(world, "What does that article say about cheque sizes?"),
      actor,
    });

    expect(world.recordedValue("I2.cheque_max")).toBeUndefined();
    expect(outcome.recorded).toEqual([]);
    expect(seen[1]?.text).toContain("REJECTED");
  });

  it("an explicit delegation in the same instruction records Q's choice", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: SO_FAR,
    });
    const said =
      "Pick three things for me that you think I would not want to see and go with those.";
    const { gateway } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I7.hard_exclusions",
                  value: ["gambling", "tobacco", "weapons"],
                  quote: "pick three things for me",
                  basis: "DELEGATED",
                },
              ],
            },
          },
        ],
      },
      { reply: "Hidden: gambling, tobacco and weapons. Change them any time." },
    ]);
    const heard: { utterance?: string; lastQ?: string }[] = [];
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: handedOver(["I7.hard_exclusions"], heard),
    });

    await agent.turn({ ...turn(world, said), actor });

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling", "tobacco", "weapons"],
    });
    // Read from their own latest words, once.
    expect(heard).toHaveLength(1);
    expect(heard[0]?.utterance).toBe(said);
  });

  it("the loop is told, as trusted input, which choices were handed to it", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: SO_FAR,
    });
    const { gateway, seen } = model([{ reply: "Done." }]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: handedOver(["I7.hard_exclusions"]),
    });

    await agent.turn({
      ...turn(
        world,
        "Pick three exclusions you think fit me and go with those.",
      ),
      actor,
    });

    const prompt = seen[0]?.text ?? "";
    const section = prompt.slice(prompt.indexOf("CHOICES HANDED TO YOU"));
    expect(section).toContain('"stepKey":"I7.hard_exclusions"');
  });

  it("a DELEGATED label the independent reading does not support writes nothing", async () => {
    // Property: whatever the acting model labels, a delegated write needs
    // the reading to have found that very step handed over.
    for (const handed of [[], ["I7.avoid"], null] as const) {
      const world = investorSession({
        currentStepKey: "I7.hard_exclusions",
        recorded: SO_FAR,
      });
      const said = "What do most investors like me exclude?";
      const { gateway } = model([
        {
          calls: [
            {
              name: "record_answers",
              arguments: {
                answers: [
                  {
                    stepKey: "I7.hard_exclusions",
                    value: ["gambling"],
                    quote: said,
                    basis: "DELEGATED",
                  },
                ],
              },
            },
          ],
        },
        { reply: "Most exclude gambling." },
      ]);
      const agent = createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(handed === null ? null : reading({ handed })),
      });

      await agent.turn({ ...turn(world, said), actor });

      expect(
        world.recordedValue("I7.hard_exclusions"),
        JSON.stringify(handed),
      ).toBeUndefined();
    }
  });

  it("a recommendation made this turn cannot be accepted this turn", async () => {
    const world = investorSession({
      currentStepKey: "I7.avoid",
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
                  stepKey: "I7.avoid",
                  value: ["gambling"],
                  because: "It rarely fits an education thesis.",
                },
              ],
            },
          },
          {
            name: "accept_recommendation",
            arguments: { stepKeys: ["I7.avoid"] },
          },
        ],
      },
      { reply: "I would suggest gambling. Shall I?" },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      // Even a reading that found approval cannot approve what the person
      // has not yet heard.
      delegation: approves(["I7.avoid"]),
    });

    await agent.turn({ ...turn(world, "What would you suggest?"), actor });

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    expect(seen[1]?.text).toContain("not been said to the person");
  });

  it("an approval after a restart binds to the same recommended payload", async () => {
    const world = investorSession({
      currentStepKey: "I7.avoid",
      recorded: SO_FAR,
    });
    const first = model([
      {
        calls: [
          {
            name: "recommend",
            arguments: {
              recommendations: [
                {
                  stepKey: "I7.avoid",
                  value: ["gambling", "tobacco"],
                  because: "They rarely fit an education thesis.",
                },
              ],
            },
          },
        ],
      },
      { reply: "I would suggest gambling and tobacco. Shall I?" },
    ]);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    }).turn({ ...turn(world, "What would you suggest?"), actor });
    expect(world.recordedValue("I7.avoid")).toBeUndefined();

    // A new process: nothing in memory survives, the store does.
    const second = model([
      {
        calls: [
          {
            name: "accept_recommendation",
            arguments: { stepKeys: ["I7.avoid"] },
          },
        ],
      },
      { reply: "Done." },
    ]);
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: approves(["I7.avoid"]),
    }).turn({ ...turn(world, "Yes, go with those."), actor });

    expect(world.recordedValue("I7.avoid")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["gambling", "tobacco"],
    });
  });

  it("an instruction about something else never approves a pending recommendation", async () => {
    // Live, 2026-09-25: Q recommended a typical cheque, the person then
    // asked for exclusions, and the acting model accepted the cheque.
    const world = investorSession({
      currentStepKey: "I7.avoid",
      recorded: SO_FAR,
    });
    await createInterviewAgent({
      gateway: model([
        {
          calls: [
            {
              name: "recommend",
              arguments: {
                recommendations: [
                  {
                    stepKey: "I7.avoid",
                    value: ["gambling"],
                    because: "It rarely fits an education thesis.",
                  },
                ],
              },
            },
          ],
        },
        { reply: "I would suggest gambling. Shall I?" },
      ]).gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    }).turn({ ...turn(world, "What would you suggest?"), actor });

    await createInterviewAgent({
      gateway: model([
        {
          calls: [
            {
              name: "accept_recommendation",
              arguments: { stepKeys: ["I7.avoid"] },
            },
          ],
        },
        { reply: "Done." },
      ]).gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: approves([]),
    }).turn({
      ...turn(world, "What discovery setting do most angels use?"),
      actor,
    });

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
  });
});

describe("Lead decision 3 · a completed answer can be corrected or taken back", () => {
  it("moves adult content from 'rather not see' to 'never show' when it was the only item", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: {
        "I0.investor_type": "angel",
        "I7.avoid": "adult_content",
      },
    });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I7.hard_exclusions",
                  value: ["adult_content"],
                  quote: "never show me adult content",
                },
              ],
            },
          },
        ],
      },
      { reply: "Adult content is now never shown." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    await agent.turn({
      ...turn(world, "Actually, never show me adult content at all."),
      actor,
    });

    expect(world.recordedValue("I7.hard_exclusions")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["adult_content"],
    });
    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    // The model is told the item left the other list, so it can say so.
    expect(seen[1]?.text).toContain("movedFrom");
  });

  it("takes an answer back entirely when the person withdraws it", async () => {
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded: { "I0.investor_type": "angel", "I7.avoid": "gambling" },
    });
    const { gateway } = model([
      {
        calls: [
          {
            name: "correct_answer",
            arguments: {
              corrections: [
                {
                  stepKey: "I7.avoid",
                  value: null,
                  quote: "forget the gambling thing",
                },
              ],
            },
          },
        ],
      },
      { reply: "Taken off." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    const outcome = await agent.turn({
      ...turn(world, "Actually forget the gambling thing."),
      actor,
    });

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    expect(world.skippedSteps()).toContain("I7.avoid");
    expect(outcome.recorded).toContain("I7.avoid");
  });
});

describe("P0-3 · the loop streams its final reply as sentences", () => {
  it("hands each sentence to onSentence while the model writes, and still returns the whole reply", async () => {
    const world = investorSession({ currentStepKey: "I2.stages" });
    const reply = "Pre-seed it is. Which geography do you focus on?";
    const json = JSON.stringify({ reply, asking: "I3.geography" });
    const gateway = {
      execute: (
        _request: unknown,
        options?: { readonly onTextDelta?: (text: string) => void },
      ) => {
        for (let at = 0; at < json.length; at += 7) {
          options?.onTextDelta?.(json.slice(at, at + 7));
        }
        return Promise.resolve({ output: { kind: "TEXT", text: json } });
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });
    const sentences: string[] = [];

    const outcome = await agent.turn({
      ...turn(world, "Pre-seed."),
      actor,
      onSentence: (sentence) => sentences.push(sentence),
    });

    expect(sentences).toEqual([
      "Pre-seed it is.",
      "Which geography do you focus on?",
    ]);
    expect(outcome.reply).toBe(reply);
  });
});
