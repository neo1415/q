import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import {
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_LIST_THEMES,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * e2e run 4 (production batch 8, 2026-11-07): Q asked "what's off the
 * table" in pieces and the exclusions three times. A plain "None." to the
 * one themed question settles every list it asked, by code, and nothing
 * the record already holds is touched.
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
const firewall: ContextFirewallPort = {
  plan: () =>
    Promise.resolve({
      outcome: "AUTHORISED",
      plan: {
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
      } as unknown as PermittedContextPlan,
    }),
};

const I = INVESTOR_STEPS;
const OFF = INVESTOR_LIST_THEMES.find((t) => t.key === "off_the_table");
const FIT = INVESTOR_LIST_THEMES.find((t) => t.key === "company_fit");

/** A model that only replies, asking the next theme. */
const replyingModel = {
  execute: () =>
    Promise.resolve({
      output: {
        kind: "TEXT",
        text: JSON.stringify({
          reply: `Understood. ${FIT?.question ?? ""}`,
          asking: I.businessModels,
        }),
      },
    }),
} as unknown as ModelGateway;

describe("a plain None to the themed exclusions question", () => {
  it("settles all four lists as None, and keeps what is already answered", async () => {
    const world = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      currentStepKey: I.sectorsAvoid,
    });
    world.record(I.sectorExclusions, {
      type: "TEXT",
      text: "Gambling and tobacco",
    });
    await createInterviewAgent({
      gateway: replyingModel,
      firewall,
      logger,
    }).turn({
      ...turn(world, "None."),
      recentTurns: [{ role: "q", text: `Thanks. ${OFF?.question ?? ""}` }],
      actor,
    });
    for (const key of [I.sectorsAvoid, I.avoid, I.hardExclusions]) {
      expect(world.recordedValue(key)).toEqual({ type: "TEXT", text: "None" });
    }
    // Already theirs: never replaced.
    expect(world.recordedValue(I.sectorExclusions)).not.toEqual({
      type: "TEXT",
      text: "None",
    });
  });

  it("a None to a question about something else settles no list", async () => {
    const world = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      currentStepKey: I.sectorsAvoid,
    });
    await createInterviewAgent({
      gateway: replyingModel,
      firewall,
      logger,
    }).turn({
      ...turn(world, "None."),
      recentTurns: [{ role: "q", text: "Do you lead rounds, or co-invest?" }],
      actor,
    });
    for (const key of OFF?.stepKeys ?? []) {
      expect(world.recordedValue(key)).toBeUndefined();
    }
  });
});

describe("an answer to some lists of a theme (owner, batch 9)", () => {
  const LEAN = INVESTOR_LIST_THEMES.find((t) => t.key === "what_you_look_for");

  it("records only what they said; the lists it did not touch stay open", async () => {
    const world = investorSession({
      steps: INVESTOR_DEFINITION_CURRENT.steps,
      currentStepKey: I.founderPreferences,
    });
    let calls = 0;
    const gateway = {
      execute: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                output: {
                  kind: "TOOL_CALLS",
                  calls: [
                    {
                      callId: "call_1",
                      name: "record_answers",
                      arguments: {
                        answers: [
                          {
                            stepKey: I.customCriteria,
                            value: "Capital efficiency",
                            quote: "capital efficiency",
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
                  text: JSON.stringify({
                    reply:
                      "Noted. Anything on founding team or green flags, or no preference?",
                    asking: I.founderPreferences,
                  }),
                },
              },
        );
      },
    } as unknown as ModelGateway;
    await createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: [I.customCriteria] })),
    }).turn({
      ...turn(world, "Mostly capital efficiency."),
      recentTurns: [{ role: "q", text: LEAN?.question ?? "" }],
      actor,
    });
    expect(world.recordedValue(I.customCriteria)).toBeDefined();
    // Never None for what they did not address.
    expect(world.recordedValue(I.founderPreferences)).toBeUndefined();
    expect(world.recordedValue(I.greenFlags)).toBeUndefined();
  });
});
