import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * The self-statement gate (ACC 2026-09-25): on tangents and advisory
 * turns Q recorded "selectively deploying" nobody said, a business title
 * "Angel investor", and geography = Kenya from "which sectors are pulling
 * seed money in Kenya". An answer goes on the record only when the
 * person's latest words, read independently of the acting model, state it
 * about themselves.
 *
 * Property: over paraphrased advisory and tangent turns, and every write
 * the acting model reaches for — with a genuine quote from those very
 * words, so only this gate stands in the way — nothing is recorded unless
 * the reading found that step stated; with the reading, it is. What the
 * reading finds is a model's; that it is read correctly across paraphrase
 * is the live eval's to measure (delegation-reader.live.test.ts).
 */

/** Every required answer, valid for its step: the journey can complete. */
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

type Write = {
  readonly stepKey: string;
  readonly value: string | readonly string[] | number;
  /** A span of the utterance, so the quote check passes. */
  readonly quoteOf: (utterance: string) => string;
};

/** Invented writes from the ACC findings, each quoting the turn itself. */
const INVENTED: readonly Write[] = [
  {
    stepKey: "I1.deployment_status",
    value: "selective",
    quoteOf: (u) => u,
  },
  {
    stepKey: "I0.business_title",
    // Free text in their words passes value support; only the gate stops it.
    value: "angel",
    quoteOf: (u) => u,
  },
  {
    stepKey: "I3.geography",
    value: ["Kenya"],
    quoteOf: (u) => u,
  },
  {
    stepKey: "I7.hard_exclusions",
    value: ["gambling"],
    quoteOf: (u) => u,
  },
];

/** Advisory and tangent turns, paraphrased; each mentions the words above. */
const ADVISORY: readonly string[] = [
  "Which sectors are pulling seed money in Kenya right now?",
  "what are angel investors in kenya backing these days",
  "Is it smart for an angel to be selective in Kenya, or to exclude gambling?",
  "Do most angels you see stay selective, or avoid gambling deals in Kenya?",
  "Curious — how selective are angel funds in Kenya about gambling startups?",
  "tell me about the Kenya angel market, is gambling a no-go for most",
];

function modelWriting(write: Write, utterance: string) {
  let round = 0;
  return {
    execute: () => {
      round += 1;
      if (round === 1) {
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: [
              {
                callId: "call_1",
                name: "record_answers",
                arguments: {
                  answers: [
                    {
                      stepKey: write.stepKey,
                      value: write.value,
                      quote: write.quoteOf(utterance),
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
          text: JSON.stringify({ reply: "Here is what I know.", asking: null }),
        },
      });
    },
  } as unknown as ModelGateway;
}

async function attempt(
  write: Write,
  utterance: string,
  stated: readonly string[] | null,
) {
  const world = investorSession({
    currentStepKey: "I2.stages",
    recorded: { "I0.investor_type": "angel" },
    taxonomy: { kenya: "a0000000-0000-4000-8000-0000000000ee" },
  });
  const agent = createInterviewAgent({
    gateway: modelWriting(write, utterance),
    firewall: firewall(),
    logger,
    recommendations: world.recommendations,
    delegation: readerOf(stated === null ? null : reading({ stated })),
  });
  const outcome = await agent.turn({ ...turn(world, utterance), actor });
  return { world, outcome };
}

describe("an answer is recorded only when their latest words state it about themselves", () => {
  it("no advisory or tangent turn records anything, whatever the acting model writes", async () => {
    for (const utterance of ADVISORY) {
      for (const write of INVENTED) {
        for (const stated of [[], ["I2.stages"], null] as const) {
          const { world, outcome } = await attempt(write, utterance, stated);
          const label = `${write.stepKey} <- "${utterance}" stated=${JSON.stringify(stated)}`;
          expect(world.recordedValue(write.stepKey), label).toBeUndefined();
          expect(outcome.recorded, label).not.toContain(write.stepKey);
        }
      }
    }
  });

  it("the same write goes through when the reading finds that step stated", async () => {
    const declarative: readonly [Write, string][] = [
      [INVENTED[0] as Write, "I'm being selective right now."],
      [
        { stepKey: "I0.business_title", value: "Partner", quoteOf: (u) => u },
        "I'm a partner there",
      ],
      [INVENTED[2] as Write, "I only invest in Kenya"],
      [INVENTED[3] as Write, "Never show me gambling."],
    ];
    for (const [write, utterance] of declarative) {
      const { world } = await attempt(write, utterance, [write.stepKey]);
      expect(world.recordedValue(write.stepKey), utterance).toBeDefined();
    }
  });

  it("a correction or a withdrawal needs the same statement", async () => {
    for (const stated of [[], ["I7.avoid"]] as const) {
      const world = investorSession({
        currentStepKey: "I2.stages",
        recorded: {
          "I0.investor_type": "angel",
          "I7.avoid": "gambling",
        },
      });
      const utterance = "Do most angels still avoid gambling these days?";
      let round = 0;
      const gateway = {
        execute: () => {
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
                        name: "correct_answer",
                        arguments: {
                          corrections: [
                            {
                              stepKey: "I7.avoid",
                              value: null,
                              quote: utterance,
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
                    text: JSON.stringify({ reply: "Noted.", asking: null }),
                  },
                },
          );
        },
      } as unknown as ModelGateway;
      const agent = createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ stated })),
      });
      await agent.turn({ ...turn(world, utterance), actor });
      const kept = world.recordedValue("I7.avoid") !== undefined;
      expect(kept, JSON.stringify(stated)).toBe(stated.length === 0);
    }
  });

  it("finishing is their decision: without it, nothing completes", async () => {
    for (const finishing of [false, true]) {
      const world = investorSession({
        currentStepKey: "I11.review",
        recorded: REQUIRED,
      });
      let round = 0;
      const gateway = {
        execute: () => {
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
                        name: "confirm_and_finish",
                        arguments: {},
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
      const agent = createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ finishing })),
      });
      const outcome = await agent.turn({
        ...turn(world, "What happens after this step?"),
        actor,
      });
      expect(
        outcome.view.session.status === "COMPLETED",
        String(finishing),
      ).toBe(finishing);
    }
  });
});
