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
 * P0-1: the four things the legacy conductor did for the voice path, now
 * the loop's — a question handed to Q for a look-up (questionForQ, with
 * where to return), a research ledger (researchEnded), a pause, and a
 * corrected pronunciation. Each is read independently from the person's
 * words (a model reading, never a word list) and decided by code.
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

/** A model that replies, asking the step it names; records what it saw. */
function replying(
  asking: string | null = "I2.stages",
  extra: Record<string, unknown> = {},
) {
  const seen: string[] = [];
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({ reply: "Sure.", asking, ...extra }),
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, seen };
}

const SO_FAR = {
  "I0.investor_type": "angel",
  "I0.organisation_name": "Harrow Road Capital",
  "I1.deployment_status": "actively_investing",
};

describe("a question that needs a look-up is handed to Q, in the person's words", () => {
  it("hands it over with where to return, asks nothing now, and tells the loop so", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const said = "Before that, who else invests in Nigerian fintech at seed?";
    const { gateway, seen } = replying();
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(
        reading({ lookup: "who else invests in Nigerian fintech at seed?" }),
      ),
    });

    const outcome = await agent.turn({ ...turn(world, said), actor });

    expect(outcome.questionForQ).toBe(
      "who else invests in Nigerian fintech at seed?",
    );
    expect(outcome.researching).toBe(outcome.questionForQ);
    expect(outcome.asking).toBeNull();
    // Back to the open question afterwards, required first.
    expect(outcome.resume?.stepKey).toBe("I1.mandate_context");
    expect(outcome.resume?.question.length).toBeGreaterThan(0);
    expect(seen[0]).toContain("A look-up will run right after your reply");
  });

  it("never hands over a model's words: a reading that is not in what they said goes on as what they said", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const said = "What are angels backing in Lagos lately?";
    const { gateway } = replying();
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(
        reading({ lookup: "top Lagos fintech investors 2026 list" }),
      ),
    }).turn({ ...turn(world, said), actor });
    expect(outcome.questionForQ).toBe(said);
  });

  it("keeps a ledger: one look-up at a time, and a route that keeps failing stops being offered", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const said = "Who backs seed healthtech in Kenya?";
    const { gateway, seen } = replying();
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ lookup: said })),
    });
    const session = turn(world, "").onboardingSessionId;

    const first = await agent.turn({ ...turn(world, said), actor });
    expect(first.questionForQ).toBe(said);
    // Still running: not handed over again, and the loop is told why.
    const second = await agent.turn({ ...turn(world, said), actor });
    expect(second.questionForQ).toBeNull();
    expect(seen.at(-1)).toContain("the last look-up is still running");

    agent.researchEnded(session, true);
    expect(
      (await agent.turn({ ...turn(world, said), actor })).questionForQ,
    ).toBe(said);

    // Failing again and again: the route is no longer offered.
    for (let i = 0; i < 6; i += 1) agent.researchEnded(session, false);
    const after = await agent.turn({ ...turn(world, said), actor });
    expect(after.questionForQ).toBeNull();
    expect(seen.at(-1)).toContain("looking things up is not available");
  });

  it("with no research composed, a look-up is never handed over", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const said = "Who backs seed healthtech in Kenya?";
    const { gateway } = replying();
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ lookup: said })),
      researchAvailable: false,
    }).turn({ ...turn(world, said), actor });
    expect(outcome.questionForQ).toBeNull();
    expect(outcome.resume).toBeNull();
  });
});

describe("a pause, read as a concept", () => {
  it("asks nothing, and the loop is told to acknowledge and keep their answers", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const { gateway, seen } = replying("I2.stages");
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ pausing: true })),
    }).turn({ ...turn(world, "Let's pick this up tomorrow."), actor });
    expect(outcome.asking).toBeNull();
    expect(outcome.questionForQ).toBeNull();
    expect(seen[0]).toContain("They want to pause");
  });

  it("without the reading, a turn is not a pause, whatever its words", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const { gateway, seen } = replying("I2.stages");
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({})),
    }).turn({ ...turn(world, "Let's pick this up tomorrow."), actor });
    expect(outcome.asking?.stepKey).toBe("I2.stages");
    expect(seen[0]).not.toContain("They want to pause");
  });
});

describe("a corrected pronunciation, from their own words", () => {
  it("is taught when they said it, and never when the reading invents it", async () => {
    for (const [pronounce, expected] of [
      [
        { term: "Kestrel", sayAs: "KES-trul" },
        { term: "Kestrel", sayAs: "KES-trul" },
      ],
      [{ term: "Kestrel", sayAs: "KESS-trell" }, null],
      [{ term: "Harrow", sayAs: "KES-trul" }, null],
    ] as const) {
      const world = investorSession({
        currentStepKey: "I2.stages",
        recorded: SO_FAR,
      });
      const { gateway, seen } = replying();
      const outcome = await createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        delegation: readerOf(reading({ pronounce })),
      }).turn({
        ...turn(world, "It's Kestrel, said KES-trul, not the bird."),
        actor,
      });
      expect(outcome.pronounce, JSON.stringify(pronounce)).toEqual(expected);
      expect(
        (seen[0] ?? "").includes("They corrected how to say"),
        JSON.stringify(pronounce),
      ).toBe(expected !== null);
    }
  });
});

describe("PRESENCE: the reply's gestures", () => {
  it("carries the model's closed-set gestures with the reply, and drops anything else", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: SO_FAR,
    });
    const { gateway } = replying("I2.stages", {
      gestures: [
        { sentence: 0, gesture: "NOD" },
        { sentence: 0, gesture: "CLAP" },
        { sentence: 1, gesture: "SPARKLES" },
      ],
    });
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({})),
    }).turn({ ...turn(world, "Mostly seed."), actor });
    expect(outcome.gestures).toEqual([{ sentence: 0, gesture: "NOD" }]);
  });
});
