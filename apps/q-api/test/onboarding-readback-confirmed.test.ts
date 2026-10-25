import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { withoutUnbackedReadingClaims } from "../src/voice/onboarding-flow.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * QA F-134 (fresh e2e 25 Oct): "Yes, everything you read from the deck is
 * right." and Q said "The deck points are confirmed." while five read-back
 * facts were still PENDING. A plain yes to readings Q just read back is
 * their approval of exactly those; and a claim that the deck's points are
 * settled is read from state, never from the model's wording.
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

const READ = "Payroll and PAYE compliance for small businesses in Ghana";
const CLAIM = "The deck points are confirmed. What stage is the company at?";

async function turnAfter(lastQ: string) {
  const world = investorSession({
    journey: "founder",
    currentStepKey: "F1.description",
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Tamarind Ledger",
    },
  });
  // A reading from their deck, waiting on them.
  await world.recommendations.recommend({
    userId: actor.userId,
    sessionId: turn(world, "").onboardingSessionId,
    stepKey: "F1.description",
    value: { type: "TEXT", text: READ },
    rationale: "found in their uploaded document",
    runId: null,
  });
  const recommendations = {
    ...world.recommendations,
    pending: async (input: { userId: string; sessionId: string }) =>
      (await world.recommendations.pending(input as never)).map((item) => ({
        ...item,
        fromDocument: true,
      })),
  };
  const agent = createInterviewAgent({
    gateway: {
      execute: () =>
        Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: CLAIM, asking: null }),
          },
        }),
    } as unknown as ModelGateway,
    firewall: firewall(),
    logger,
    recommendations,
    delegation: readerOf(reading({})),
  });
  const outcome = await agent.turn({
    ...turn(world, "Yes, everything you read from the deck is right."),
    recentTurns: [{ role: "q", text: lastQ }],
    actor,
  });
  const pending = await world.recommendations.pending({
    userId: actor.userId,
    sessionId: turn(world, "").onboardingSessionId,
  });
  return { outcome: JSON.stringify(outcome), pending };
}

describe("a deck read-back is confirmed only in fact (QA F-134, 25 Oct)", () => {
  it("a plain yes to the readings Q just read back accepts exactly those", async () => {
    const { pending } = await turnAfter(
      `From your deck: ${READ}. Is that right?`,
    );
    expect(pending).toHaveLength(0);
  });

  it("readings Q never read back stay waiting, and the reply never calls them confirmed", async () => {
    const { outcome, pending } = await turnAfter(
      "What stage is the company at?",
    );
    expect(pending).toHaveLength(1);
    expect(outcome).not.toContain("deck points are confirmed");
  });
});

describe("withoutUnbackedReadingClaims", () => {
  const reply =
    "The deck points are confirmed. Your deck review is already reflected in your profile. What stage are you at?";
  it("takes the claim out while readings wait and none was accepted", () => {
    expect(
      withoutUnbackedReadingClaims(reply, {
        acceptedThisTurn: false,
        stillWaiting: 5,
      }),
    ).toBe("What stage are you at?");
  });
  it("leaves it when this turn accepted, or nothing waits", () => {
    expect(
      withoutUnbackedReadingClaims(reply, {
        acceptedThisTurn: true,
        stillWaiting: 4,
      }),
    ).toBe(reply);
    expect(
      withoutUnbackedReadingClaims(reply, {
        acceptedThisTurn: false,
        stillWaiting: 0,
      }),
    ).toBe(reply);
  });
});
