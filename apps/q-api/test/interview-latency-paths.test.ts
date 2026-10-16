import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { codeReading } from "../src/voice/code-reading.js";
import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";
import { quickAcknowledgement } from "../src/voice/quick-acknowledgement.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/** An answer as the record tool hands it to the port: stated, not own words. */
const stated = (stepKey: string, value: string | number, quote: string) => ({
  stepKey,
  value,
  quote,
  basis: "STATED" as const,
  ownWords: false,
});

/**
 * Typed-turn latency (owner 2026-10-16), the behaviour that buys it: one
 * transactional save for several answers, a reply code writes only after a
 * clean commit, and a reading code decides only where it is exact. Each
 * keeps the guarantee it replaces: nothing said saved before it commits,
 * nothing recorded the person did not state.
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

const founderWorld = () =>
  investorSession({
    journey: "founder",
    currentStepKey: "F1.website",
    recorded: {
      "F0.intent": "raising_now",
      "F1.company_name": "Quillmark Health",
    },
  });

type Answer = { stepKey: string; value: string | number; quote: string };

/** A model that records these answers in its first round, then replies. */
function recordingModel(answers: Answer[]) {
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
                    arguments: { answers },
                  },
                ],
              },
            }
          : {
              output: {
                kind: "TEXT",
                text: JSON.stringify({
                  reply: "The model's own reply. What else?",
                  asking: null,
                }),
              },
            },
      );
    },
  } as unknown as ModelGateway;
  return { gateway, calls: () => calls };
}

describe("several answers, one transactional save", () => {
  it("records every answer of one breath in ONE batch, not a round trip each", async () => {
    const world = founderWorld();
    const said = "Seed stage, in Kenya, two founders and 14 people.";
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () =>
        Promise.resolve(
          reading({
            stated: [
              "F1.stage",
              "F1.country",
              "F4.founder_count",
              "F4.team_size",
            ],
          }),
        ),
    });
    const results = await port.record([
      stated("F1.stage", "seed", "Seed stage"),
      stated("F1.country", "ke", "in Kenya"),
      stated("F4.founder_count", 2, "two founders"),
      stated("F4.team_size", 14, "14 people"),
    ]);
    expect(results.map((r) => r.outcome)).toEqual([
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
    ]);
    expect(world.batches()).toEqual([
      ["F1.stage", "F1.country", "F4.founder_count", "F4.team_size"],
    ]);
    expect(world.recordedValue("F4.team_size")).toEqual({
      type: "RANGE",
      value: "14",
    });
  });

  it("one the journey refuses is reported with its reason; the others commit", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.website",
      recorded: { "F0.intent": "raising_now" },
      // The fake journey refuses the stage until the company name is in.
      refuseUntil: { "F1.stage": "F1.company_name" },
    });
    const said = "Seed stage, in Kenya.";
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () =>
        Promise.resolve(reading({ stated: ["F1.stage", "F1.country"] })),
    });
    const results = await port.record([
      stated("F1.stage", "seed", "Seed stage"),
      stated("F1.country", "ke", "in Kenya"),
    ]);
    expect(results[0]?.outcome).toBe("NEEDS_FIRST");
    expect(results[1]?.outcome).toBe("COMMITTED");
    expect(world.recordedValue("F1.stage")).toBeUndefined();
    expect(world.recordedValue("F1.country")).toBeDefined();
  });

  it("an older service with no batch route still gets every answer, one by one", async () => {
    const world = founderWorld();
    const said = "Seed stage, in Kenya.";
    const base = turn(world, said).session;
    const withoutBatch: typeof fetch = (input, init) =>
      (input instanceof Request ? input.url : input.toString()).endsWith(
        "/responses/batch",
      )
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                type: "about:blank",
                title: "Not found",
                status: 404,
                code: "RESOURCE_NOT_FOUND",
                requestId: "req_test",
              }),
              {
                status: 404,
                headers: { "content-type": "application/problem+json" },
              },
            ),
          )
        : world.fetch(input, init);
    const port = createOnboardingPort({
      session: { ...base, fetch: withoutBatch },
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [said],
      authority: () =>
        Promise.resolve(reading({ stated: ["F1.stage", "F1.country"] })),
    });
    const results = await port.record([
      stated("F1.stage", "seed", "Seed stage"),
      stated("F1.country", "ke", "in Kenya"),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(["COMMITTED", "COMMITTED"]);
    expect(world.batches()).toEqual([]);
    expect(world.attempts()).toEqual(["F1.stage", "F1.country"]);
  });
});

describe("the reply after a clean save is written by code", () => {
  const said = "Seed stage, based in Kenya.";
  const answers = [
    { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
    { stepKey: "F1.country", value: "ke", quote: "based in Kenya" },
  ];

  it("one model round: what committed, then the next coverage question", async () => {
    const world = founderWorld();
    const model = recordingModel(answers);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toMatch(/saved|on your record/i);
    expect(outcome.reply).toContain("stage: Seed");
    expect(outcome.reply).toContain("country: Kenya");
    expect(outcome.reply.trim().endsWith("?")).toBe(true);
    // Said only after the commit: both are on the record.
    expect(world.recordedValue("F1.stage")).toBeDefined();
    expect(world.recordedValue("F1.country")).toBeDefined();
  });

  it("a refused answer goes back to the model, which says what did not go in", async () => {
    const world = founderWorld();
    const model = recordingModel([
      ...answers,
      // Not in their words: refused, so the reply needs judgement.
      { stepKey: "F4.team_size", value: 14, quote: "fourteen people" },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBe(2);
    expect(outcome.reply).toContain("The model's own reply.");
    expect(world.recordedValue("F4.team_size")).toBeUndefined();
  });

  it("a reading that asks more of the turn (finishing) goes back to the model", async () => {
    const world = founderWorld();
    const model = recordingModel(answers);
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(
        reading({ stated: ["F1.stage", "F1.country"], finishing: true }),
      ),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBeGreaterThanOrEqual(2);
  });

  it("words not in English are the model's to answer, in their language", async () => {
    const world = founderWorld();
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "مرحلة البذرة" },
    ]);
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, "نحن في مرحلة البذرة"), actor });
    expect(model.calls()).toBe(2);
  });
});

describe("quickAcknowledgement", () => {
  const next = { question: "What does the company do?", optional: false };
  const labelOf = (key: string) =>
    ({ "F1.stage": "Stage", "F4.team_size": "Team size" })[key];

  it("reads back each committed value with its label, then asks", () => {
    expect(
      quickAcknowledgement({
        results: [
          { stepKey: "F1.stage", outcome: "COMMITTED", recorded: "Seed" },
          { stepKey: "F4.team_size", outcome: "COMMITTED", recorded: "14" },
        ],
        labelOf,
        next,
        turnIndex: 0,
      }),
    ).toBe(
      "Got it, saved: stage: Seed; team size: 14. What does the company do?",
    );
  });

  it("never when anything was not committed (a held save is not saved)", () => {
    expect(
      quickAcknowledgement({
        results: [
          { stepKey: "F1.stage", outcome: "COMMITTED", recorded: "Seed" },
          { stepKey: "F4.team_size", outcome: "HELD_FOR_RETRY" },
        ],
        labelOf,
        next,
        turnIndex: 0,
      }),
    ).toBeNull();
  });

  it("never with nothing to ask next (the closing summary is the model's)", () => {
    expect(
      quickAcknowledgement({
        results: [
          { stepKey: "F1.stage", outcome: "COMMITTED", recorded: "Seed" },
        ],
        labelOf,
        next: null,
        turnIndex: 0,
      }),
    ).toBeNull();
  });
});

describe("codeReading: only the exact case, never wider than the reader", () => {
  const stepOf = (key: string) =>
    FOUNDER_DEFINITION_CURRENT.steps.find((s) => s.stepKey === key);

  it("a reply that is exactly a choice of the asked step states that step only", () => {
    const read = codeReading({
      utterance: "Series A.",
      asked: stepOf("F1.stage"),
      pendingCount: 0,
    });
    expect([...(read?.stated ?? [])]).toEqual(["F1.stage"]);
    expect(read?.handed.size).toBe(0);
    expect(read?.approved.size).toBe(0);
    expect(read?.finishing).toBe(false);
  });

  it("a bare figure for an asked number step", () => {
    expect(
      codeReading({
        utterance: "14",
        asked: stepOf("F4.team_size"),
        pendingCount: 0,
      })?.stated.has("F4.team_size"),
    ).toBe(true);
  });

  it("anything more, a waiting recommendation, or no asked step: the reader decides", () => {
    for (const [utterance, key, pending] of [
      ["Seed, and you pick the rest", "F1.stage", 0],
      ["14 people", "F4.team_size", 0],
      ["Seed", "F1.stage", 1],
      ["Seed", "F1.description", 0],
    ] as const) {
      expect(
        codeReading({ utterance, asked: stepOf(key), pendingCount: pending }),
        utterance,
      ).toBeNull();
    }
    expect(
      codeReading({ utterance: "Seed", asked: undefined, pendingCount: 0 }),
    ).toBeNull();
  });
});
