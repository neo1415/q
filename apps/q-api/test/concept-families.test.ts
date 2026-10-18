import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { INVESTOR_CONCEPT_FAMILIES } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import type { OnboardingStepState } from "@capital-q/q-tools";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { settleFamilies } from "../src/voice/onboarding-port.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * One concept, one answer (G; ACC 2026-09-25: after gambling was recorded,
 * Q asked whether any sectors should be excluded outright). Once any step
 * of a concept family is answered or declined, the others are covered:
 * not still open, never offered as the question.
 */

const FAMILY = INVESTOR_CONCEPT_FAMILIES[0]?.stepKeys ?? [];

function row(
  stepKey: string,
  status: OnboardingStepState["status"],
  required = false,
): OnboardingStepState {
  return {
    stepKey,
    question: stepKey,
    kind: "MANY_OF",
    required,
    status,
    value: status === "ANSWERED" ? "Gambling" : null,
  };
}

describe("a settled concept covers the rest of its family", () => {
  it("every other open member is covered by whichever member settled it", () => {
    for (const settler of FAMILY) {
      for (const how of ["ANSWERED", "SET_ASIDE"] as const) {
        const rows = [
          ...FAMILY.map((key) => row(key, key === settler ? how : "OPEN")),
          row("I3.geography", "OPEN"),
          row("I2.stages", "OPEN", true),
        ];
        const settled = settleFamilies(rows, "investor");
        for (const r of settled) {
          const label = `${settler} ${how} -> ${r.stepKey}`;
          if (FAMILY.includes(r.stepKey) && r.stepKey !== settler) {
            expect(r.coveredBy, label).toBe(settler);
          } else {
            expect(r.coveredBy, label).toBeUndefined();
          }
        }
      }
    }
  });

  it("nothing is covered while no member is settled, and founders have no families here", () => {
    const rows = FAMILY.map((key) => row(key, "OPEN"));
    expect(
      settleFamilies(rows, "investor").some((r) => r.coveredBy !== undefined),
    ).toBe(false);
    const answered = FAMILY.map((key, i) =>
      row(key, i === 0 ? "ANSWERED" : "OPEN"),
    );
    expect(
      settleFamilies(answered, "founder").some(
        (r) => r.coveredBy !== undefined,
      ),
    ).toBe(false);
  });
});

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

describe("the loop never offers a covered step as its question", () => {
  it("the state says it is covered, and the screen is not given it to ask", async () => {
    const world = investorSession({
      currentStepKey: "I7.sector_exclusions",
      recorded: {
        "I0.investor_type": "angel",
        "I1.deployment_status": "actively_investing",
        "I7.hard_exclusions": "gambling",
      },
    });
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
              reply: "Any sectors to exclude outright?",
              asking: "I7.sector_exclusions",
            }),
          },
        });
      },
    } as unknown as ModelGateway;
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    }).turn({ ...turn(world, "Seed stage only."), actor });

    expect(seen[0]).toContain('"coveredBy":"I7.hard_exclusions"');
    expect(outcome.asking).toBeNull();
    expect(outcome.askingAbout).toEqual([]);
  });

  it("the write that settles a concept leaves the rest of its family out of what is still open", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: {
        "I0.investor_type": "angel",
        "I1.deployment_status": "actively_investing",
      },
    });
    const seen: string[] = [];
    let round = 0;
    const gateway = {
      execute: (request: {
        readonly messages: readonly { readonly content: string }[];
      }) => {
        seen.push(request.messages.map((m) => m.content).join("\n"));
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
                            stepKey: "I7.hard_exclusions",
                            value: ["gambling"],
                            quote: "never show me gambling",
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
                  text: JSON.stringify({ reply: "Done.", asking: null }),
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
    }).turn({ ...turn(world, "Never show me gambling."), actor });

    const after = seen[1] ?? "";
    const stillOpen = after.slice(after.indexOf('"stillOpen"'));
    expect(after).toContain('"outcome":"COMMITTED"');
    for (const key of FAMILY.filter((k) => k !== "I7.hard_exclusions")) {
      expect(stillOpen.includes(`"stepKey":"${key}"`), key).toBe(false);
    }
  });
});
