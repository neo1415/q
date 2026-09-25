import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * A decline of an optional step is an answer (ACC 2026-09-25: on a category
 * step Q said it could not record "no preference" and told the person to
 * say "skip"). Asserted on what the session holds: the step is set aside,
 * no value is recorded, it is not open any more, and a required step or a
 * decline the reading did not find changes nothing.
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

function settingAside(stepKey: string, quote: string) {
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
                    name: "set_aside",
                    arguments: { steps: [{ stepKey, quote }] },
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
  return { gateway, seen };
}

const SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Harrow Road Capital",
  "I1.deployment_status": "actively_investing",
};

/** Optional steps of several kinds, and ways a person declines them. */
const OPTIONAL = [
  "I3.geography",
  "I3.sectors",
  "I7.avoid",
  "I7.sector_exclusions",
  "I4.business_models",
];
const DECLINES = [
  "no preference",
  "nothing really",
  "doesn't matter to me",
  "I'd rather not say",
];

describe("a declined optional step is set aside, never recorded as a value", () => {
  it("sets aside each kind of optional step, however they decline it", async () => {
    for (const stepKey of OPTIONAL) {
      for (const said of DECLINES) {
        const world = investorSession({ currentStepKey: stepKey, recorded: SO_FAR });
        const { gateway, seen } = settingAside(stepKey, said);
        const agent = createInterviewAgent({
          gateway,
          firewall: firewall(),
          logger,
          recommendations: world.recommendations,
          delegation: readerOf(reading({ declined: [stepKey] })),
        });

        const outcome = await agent.turn({ ...turn(world, said), actor });

        const label = `${stepKey} <- "${said}"`;
        expect(world.skippedSteps(), label).toContain(stepKey);
        expect(world.recordedValue(stepKey), label).toBeUndefined();
        // The loop was told it was declined, and after the result it is
        // no longer among what is still open.
        expect(seen[0], label).toContain(`"stepKey":"${stepKey}"`);
        const after = seen[1] ?? "";
        expect(after, label).toContain('"outcome":"SET_ASIDE"');
        expect(
          after.slice(after.indexOf('"stillOpen"')).includes(`"${stepKey}"`),
          label,
        ).toBe(false);
        expect(outcome.degraded).toBe(false);
      }
    }
  });

  it("declining what they had answered takes it back, with history, and sets it aside", async () => {
    const world = investorSession({
      currentStepKey: "I7.avoid",
      recorded: { ...SO_FAR, "I7.avoid": "gambling" },
    });
    const { gateway } = settingAside("I7.avoid", "actually, no preference");
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ declined: ["I7.avoid"] })),
    }).turn({ ...turn(world, "actually, no preference"), actor });

    expect(world.recordedValue("I7.avoid")).toBeUndefined();
    expect(world.skippedSteps()).toContain("I7.avoid");
  });

  it("never sets aside a required step, nor one the reading did not find declined", async () => {
    for (const [stepKey, declined] of [
      ["I2.stages", ["I2.stages"]],
      ["I3.geography", []],
      ["I3.geography", ["I3.sectors"]],
    ] as const) {
      const world = investorSession({ currentStepKey: stepKey, recorded: SO_FAR });
      const { gateway, seen } = settingAside(stepKey, "no preference");
      await createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ declined })),
      }).turn({ ...turn(world, "no preference"), actor });

      expect(world.skippedSteps(), stepKey).not.toContain(stepKey);
      expect(seen[1], stepKey).toContain('"outcome":"REJECTED"');
    }
  });

  it("an unreadable turn sets nothing aside", async () => {
    const world = investorSession({ currentStepKey: "I3.geography", recorded: SO_FAR });
    const { gateway } = settingAside("I3.geography", "no preference");
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(null),
    }).turn({ ...turn(world, "no preference"), actor });
    expect(world.skippedSteps()).not.toContain("I3.geography");
  });
});
