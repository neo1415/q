import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInterviewAgent,
  refusedStepsOf,
} from "../src/voice/interview-agent.js";
import { UPLOAD_ONLY_REASON } from "../src/voice/onboarding-port.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live 2026-10-01 (q-api trace): a step the reading said was stated early
 * on was put back to the loop as "given earlier, record it now" on every
 * later turn, and refused every time ("a deck and audited financials" on an
 * upload step, eight turns, one model round each). After two refused turns
 * the loop is no longer told to record it.
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
function firewall(): ContextFirewallPort {
  const plan = {
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
  } as unknown as PermittedContextPlan;
  return { plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }) };
}

const FIRST = "We back founders as a family office, mostly fintech.";

/**
 * Every turn: one round writing an answer no option holds (refused as
 * UNMATCHED), then the reply. Every prompt is kept.
 */
function retrying() {
  const prompts: string[] = [];
  let round = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      round += 1;
      return Promise.resolve(
        round % 2 === 1
          ? {
              output: {
                kind: "TOOL_CALLS",
                text: "",
                calls: [
                  {
                    callId: `c${String(round)}`,
                    name: "record_answers",
                    arguments: {
                      answers: [
                        {
                          stepKey: "I0.investor_type",
                          value: "zzz not an option",
                          quote: FIRST,
                        },
                      ],
                    },
                  },
                ],
              },
            }
          : {
              output: {
                kind: "TEXT",
                text: JSON.stringify({ reply: "Sure.", asking: null }),
              },
            },
      );
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

const GIVEN = "They already answered these earlier in this conversation";

describe("a refused write is let go after two turns", () => {
  it("stops telling the loop to record a step its writes keep being refused for", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway, prompts } = retrying();
    let stated: readonly string[] = ["I0.investor_type"];
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(() => reading({ stated })),
    });

    await agent.turn({ ...turn(world, FIRST), actor });
    stated = [];
    await agent.turn({ ...turn(world, "Anyway, what next?"), actor });
    const secondTurn = prompts.at(-2) ?? "";
    // Turn two still carries it: one refusal is not enough to let go.
    expect(secondTurn).toContain(GIVEN);
    expect(secondTurn).toContain("I0.investor_type");

    await agent.turn({ ...turn(world, "Sure, go on."), actor });
    const thirdTurn = prompts.at(-2) ?? "";
    expect(thirdTurn).not.toContain(GIVEN);
  });
});

describe("which writes count as refused", () => {
  const action = (outcome: string, reason?: string) => ({
    tool: "record_answers",
    input: { answers: [{ stepKey: "F2.materials", basis: "STATED" }] },
    result: {
      data: {
        results: [
          {
            stepKey: "F2.materials",
            outcome,
            ...(reason === undefined ? {} : { reason }),
          },
        ],
      },
    },
  });

  it("counts a refusal, including the upload step's", () => {
    expect(refusedStepsOf([action("REJECTED", UPLOAD_ONLY_REASON)])).toEqual([
      "F2.materials",
    ]);
    expect(refusedStepsOf([action("UNMATCHED", "names none")])).toEqual([
      "F2.materials",
    ]);
  });

  it("never counts a write held for their confirmation, or one that landed", () => {
    expect(
      refusedStepsOf([
        action(
          "REJECTED",
          "Held for their confirmation, not recorded yet: it is your reading",
        ),
      ]),
    ).toEqual([]);
    expect(refusedStepsOf([action("COMMITTED")])).toEqual([]);
  });
});

describe("a required question pressed twice running is rested (HANDOVER §5.1)", () => {
  it("tells the loop not to ask it on the third turn, and lets it come back after", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const prompts: string[] = [];
    let asking: string | null = "I0.investor_type";
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "Sure.", asking }),
          },
        });
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading()),
    });
    const REST = "do not ask I0.investor_type";

    await agent.turn({ ...turn(world, "Lovely weather in Lagos."), actor });
    await agent.turn({ ...turn(world, "We had rain all week."), actor });
    expect(prompts.at(-1)).not.toContain(REST);
    // The rested turn's reply asks something else, as the note says.
    asking = null;
    await agent.turn({ ...turn(world, "My dog hates it."), actor });
    expect(prompts.at(-1)).toContain(REST);

    // After a rest the question may come back.
    await agent.turn({ ...turn(world, "Ha, anyway."), actor });
    expect(prompts.at(-1)).not.toContain(REST);
  });
});

describe("an answer no option holds, on a step that cannot keep other words", () => {
  it("is told to recommend the closest once, never to ask the same choice again", async () => {
    const world = investorSession({ currentStepKey: "I2.currency" });
    const prompts: string[] = [];
    let round = 0;
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        round += 1;
        return Promise.resolve(
          round === 1
            ? {
                output: {
                  kind: "TOOL_CALLS",
                  text: "",
                  calls: [
                    {
                      callId: "c1",
                      name: "record_answers",
                      arguments: {
                        answers: [
                          {
                            stepKey: "I2.currency",
                            value: "seashells",
                            quote: "We write cheques in seashells.",
                          },
                        ],
                      },
                    },
                  ],
                },
              }
            : {
                output: {
                  kind: "TEXT",
                  text: JSON.stringify({ reply: "Ok.", asking: null }),
                },
              },
        );
      },
    } as unknown as ModelGateway;
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I2.currency"] })),
    }).turn({ ...turn(world, "We write cheques in seashells."), actor });
    expect(prompts[1]).toContain("this step cannot keep other words");
  });
});
