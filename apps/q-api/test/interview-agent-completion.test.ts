import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Completion (ACC 2026-09-25): the mandate went ACTIVE while the session
 * stayed open. Properties: finishing completes the session whenever every
 * required step is done, however many optional steps are open or set
 * aside; a review already confirmed (by another door, or an earlier turn)
 * is finished, not left half-way; and the review is never confirmed by
 * anything but finishing.
 */

const REQUIRED: Readonly<Record<string, string>> = Object.fromEntries(
  INVESTOR_DEFINITION_V1.steps
    .filter(
      (step) => step.required && step.configuration.stepType !== "confirmation",
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

const OPTIONAL_ANSWERS: readonly Readonly<Record<string, string>>[] = [
  {},
  { "I7.avoid": "gambling" },
  { "I3.sectors_avoid": "a0000000-0000-4000-8000-0000000000aa" },
  { "I7.hard_exclusions": "weapons", "I2.cheque_typical": "50000" },
];

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

function calling(name: string, args: unknown): ModelGateway {
  let round = 0;
  return {
    execute: () => {
      round += 1;
      return Promise.resolve(
        round === 1
          ? {
              output: {
                kind: "TOOL_CALLS",
                text: "",
                calls: [{ callId: "c1", name, arguments: args }],
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
}

describe("finishing completes the session whenever every required step is done", () => {
  it("whatever optional steps are open, answered or already confirmed", async () => {
    for (const optional of OPTIONAL_ANSWERS) {
      for (const reviewAlreadyConfirmed of [false, true]) {
        const world = investorSession({
          currentStepKey: "I11.review",
          recorded: {
            ...REQUIRED,
            ...optional,
            ...(reviewAlreadyConfirmed ? { "I11.review": "true" } : {}),
          },
        });
        const outcome = await createInterviewAgent({
          gateway: calling("confirm_and_finish", {}),
          firewall: firewall(),
          logger,
          recommendations: world.recommendations,
          delegation: readerOf(reading({ finishing: true })),
        }).turn({ ...turn(world, "Yes, that's right. Let's finish."), actor });

        const label = `${JSON.stringify(optional)} review=${String(reviewAlreadyConfirmed)}`;
        expect(outcome.view.session.status, label).toBe("COMPLETED");
        expect(outcome.navigate, label).toBe("DISCOVER");
      }
    }
  });
});

describe("the review is confirmed only by finishing", () => {
  // Live 2026-09-30: a review agreed to through record_answers was refused
  // over and over. Agreeing to the last review now finishes, all the way to
  // a completed session, so it never leaves the setup half-activated.
  it("record_answers and correct_answer confirming the last review finish the setup", async () => {
    for (const [name, args] of [
      [
        "record_answers",
        {
          answers: [
            { stepKey: "I11.review", value: true, quote: "Yes, that's right." },
          ],
        },
      ],
      [
        "correct_answer",
        {
          corrections: [
            { stepKey: "I11.review", value: true, quote: "Yes, that's right." },
          ],
        },
      ],
    ] as const) {
      const world = investorSession({
        currentStepKey: "I11.review",
        recorded: REQUIRED,
      });
      const outcome = await createInterviewAgent({
        gateway: calling(name, args),
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ stated: ["I11.review"] })),
      }).turn({ ...turn(world, "Yes, that's right."), actor });

      expect(world.recordedValue("I11.review"), name).toBeDefined();
      expect(outcome.view.session.status, name).toBe("COMPLETED");
    }
  });

  it("a review they have not agreed to is never confirmed", async () => {
    const world = investorSession({
      currentStepKey: "I11.review",
      recorded: REQUIRED,
    });
    const outcome = await createInterviewAgent({
      gateway: calling("record_answers", {
        answers: [
          { stepKey: "I11.review", value: true, quote: "What happens next?" },
        ],
      }),
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({})),
    }).turn({ ...turn(world, "What happens next?"), actor });

    expect(world.recordedValue("I11.review")).toBeUndefined();
    expect(outcome.view.session.status).toBe("ACTIVE");
  });
});

describe("the reading runs alongside the first round (live 2026-09-30)", () => {
  const slowReader = (value: ReturnType<typeof reading>) => ({
    read: () =>
      new Promise<ReturnType<typeof reading>>((resolve) => {
        setTimeout(() => {
          resolve(value);
        }, 30);
      }),
  });
  const replying = () => {
    const prompts: string[] = [];
    const gateway = {
      execute: (request: { messages: { content: string }[] }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        return Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "What's next?", asking: null }),
          },
        });
      },
    } as unknown as ModelGateway;
    return { gateway, prompts };
  };

  it("a reply written before the reading is kept when the reading asks nothing more", async () => {
    const world = investorSession({ currentStepKey: "I11.review" });
    const { gateway, prompts } = replying();
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: slowReader(reading({})),
    }).turn({ ...turn(world, "Sounds good."), actor });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("not read yet this round");
    expect(outcome.reply).toBe("What's next?");
  });

  it("is written again when the reading turns out to ask something of the turn", async () => {
    const world = investorSession({ currentStepKey: "I11.review" });
    const { gateway, prompts } = replying();
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: slowReader(reading({ pausing: true })),
    }).turn({ ...turn(world, "Can we stop for today?"), actor });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("They want to pause");
  });
});

describe("what an earlier utterance stated stays theirs (live 2026-09-30)", () => {
  it("an answer from their monologue is recorded on a later turn, quoting it", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const monologue =
      "Our firm is Kola Capital, based in Lagos, and we back pre-seed.";
    let turnNo = 0;
    const gateway = {
      execute: () => {
        turnNo += 1;
        // Turn 1 writes nothing; turn 2 records from the turn-1 words.
        if (turnNo === 2) {
          return Promise.resolve({
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
                        stepKey: "I0.organisation_name",
                        value: "Kola Capital",
                        quote: "Our firm is Kola Capital",
                      },
                    ],
                  },
                },
              ],
            },
          });
        }
        return Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "Got it.", asking: null }),
          },
        });
      },
    } as unknown as ModelGateway;
    let readings = 0;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(() => {
        readings += 1;
        return readings === 1
          ? reading({ stated: ["I0.organisation_name"] })
          : reading({});
      }),
    });
    await agent.turn({ ...turn(world, monologue), actor });
    expect(world.recordedValue("I0.organisation_name")).toBeUndefined();
    await agent.turn({
      ...turn(world, "sure"),
      recentTurns: [
        { role: "person", text: monologue },
        { role: "q", text: "Got it." },
      ],
      actor,
    });
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Kola Capital",
    });
  });

  it("an answer no earlier reading stated stays refused", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const { gateway } = {
      gateway: {
        execute: () =>
          Promise.resolve({
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
                        stepKey: "I0.investor_type",
                        value: "vc",
                        quote: "a venture capital fund",
                      },
                    ],
                  },
                },
              ],
            },
          }),
      },
    };
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({})),
    }).turn({
      ...turn(world, "what do people usually say?"),
      recentTurns: [
        { role: "person", text: "is a venture capital fund common here?" },
      ],
      actor,
    });
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
  });
});

describe("a choice read from earlier words is said back, not recorded (live 2026-09-30)", () => {
  it("does not record an option from an earlier utterance without their agreement now", async () => {
    const world = investorSession({ currentStepKey: "I0.investor_type" });
    const monologue = "We did Y Combinator summer 25 and we move fast.";
    let calls = 0;
    const gateway = {
      execute: () => {
        calls += 1;
        return Promise.resolve(
          calls === 2
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
                            stepKey: "I0.investor_type",
                            value: "accelerator",
                            quote: "We did Y Combinator summer 25",
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
    let readings = 0;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(() => {
        readings += 1;
        return readings === 1
          ? reading({ stated: ["I0.investor_type"] })
          : reading({});
      }),
    });
    await agent.turn({ ...turn(world, monologue), actor });
    await agent.turn({
      ...turn(world, "anyway"),
      recentTurns: [{ role: "person", text: monologue }],
      actor,
    });
    expect(world.recordedValue("I0.investor_type")).toBeUndefined();
    // Held for their yes, with where it came from.
    const pending = await world.recommendations.pending({
      userId: actor.userId,
      sessionId: "f0000000-0000-4000-8000-000000000010",
    });
    expect(pending.map((p) => p.stepKey)).toContain("I0.investor_type");
  });
});
