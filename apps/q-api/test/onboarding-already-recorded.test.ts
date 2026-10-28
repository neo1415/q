import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import {
  quickAcknowledgement,
  quickReceipt,
  receiptValueOf,
} from "../src/voice/quick-acknowledgement.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Live e2e 25 Oct 2026: a note kept earlier ("Paying customers: the 210
 * customers is right") was restated as saved on every unrelated turn,
 * once twice in one reply, and came back as an offer to confirm. What is
 * already on the record is marked so at the write, and never said or
 * offered again.
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

const NOTE = "Paying customers: the 210 customers is right";
const RESTATED =
  "Thanks, I've noted paying customers kept in your notes. What early signal do you have?";

describe("what is already on the record is never said or offered again (live e2e 25 Oct)", () => {
  it("a summary already in that step's notes is not held as a new offer, and the reply does not restate it", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.description",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Tamarind Ledger",
        "F7.follow_up": `Revenue: first revenue only\n${NOTE}`,
      },
    });
    let round = 0;
    const agent = createInterviewAgent({
      gateway: {
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
                        callId: "call_1",
                        name: "record_answers",
                        arguments: {
                          answers: [
                            {
                              stepKey: "F7.follow_up",
                              value: NOTE,
                              quote: "the 210 customers is right",
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
                    text: JSON.stringify({ reply: RESTATED, asking: null }),
                  },
                },
          );
        },
      } as unknown as ModelGateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["F7.follow_up"] })),
    });
    const outcome = await agent.turn({
      ...turn(world, "Yes, and the 210 customers is right."),
      recentTurns: [],
      actor,
    });
    const pending = await world.recommendations.pending({
      userId: actor.userId,
      sessionId: turn(world, "").onboardingSessionId,
    });
    expect(pending.map((p) => p.value)).not.toContainEqual(
      expect.objectContaining({ text: NOTE }),
    );
    const reply = JSON.stringify(outcome);
    expect(reply).not.toContain("I've noted the 210 customers");
  });

  const kept = {
    stepKey: "F5.customers",
    outcome: "COMMITTED" as const,
    recorded: `${NOTE} (kept with their notes: already there)`,
    alreadyRecorded: true as const,
  };
  const stage = {
    stepKey: "F2.stage",
    outcome: "COMMITTED" as const,
    recorded: "Seed",
  };
  const next = { question: "What early signal do you have?", optional: false };
  const labelOf = (key: string) =>
    ({ "F2.stage": "Stage", "F5.customers": "Paying customers" })[key];

  it("the code-written reply says only what is new", () => {
    expect(
      quickAcknowledgement({
        results: [kept, stage],
        labelOf,
        next,
        turnIndex: 0,
      }),
    ).toBe("Got it, I've saved Seed (stage). What early signal do you have?");
  });

  it("with nothing new, it asks the next question and claims no save", () => {
    expect(
      quickAcknowledgement({ results: [kept], labelOf, next, turnIndex: 1 }),
    ).toBe("What early signal do you have?");
    expect(quickReceipt({ results: [kept], labelOf, turnIndex: 1 })).toBeNull();
  });

  it("a kept note reads back by its words, so a reply repeating it is caught", () => {
    expect(receiptValueOf(kept)).toBe("the 210 customers is right");
    expect(receiptValueOf(stage)).toBe("Seed");
  });
});
