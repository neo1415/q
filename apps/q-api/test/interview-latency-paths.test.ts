import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import { codeReading } from "../src/voice/code-reading.js";
import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";
import { quickAcknowledgement } from "../src/voice/quick-acknowledgement.js";
import { INITIAL_CONDUCT } from "../src/voice/conduct.js";
import type { StandingStore } from "../src/voice/standing.js";

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
    // Founder v8: the country is a geography node, found by its name.
    taxonomy: { kenya: countryOfIso("KE")?.nodeId ?? "" },
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
      stated("F1.country", "Kenya", "in Kenya"),
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
      taxonomy: { kenya: countryOfIso("KE")?.nodeId ?? "" },
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
      stated("F1.country", "Kenya", "in Kenya"),
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
      stated("F1.country", "Kenya", "in Kenya"),
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
    { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
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
    expect(outcome.reply).toContain("Seed (stage)");
    expect(outcome.reply).toContain("Kenya (country)");
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

describe("faster answers, with their stages shown (owner 2026-10-21)", () => {
  const said = "Seed stage, based in Kenya.";
  const answers = [
    { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
    { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
  ];

  it("shows only stages that name something: the steps being saved (owner review 2026-10-21)", async () => {
    const world = founderWorld();
    const model = recordingModel(answers);
    const stages: string[] = [];
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({
      ...turn(world, said),
      actor,
      onStage: (stage) => stages.push(`${stage.stage}:${stage.label}`),
    });
    // By the journey's own labels; never "reading what you said" or
    // "writing a reply".
    expect(stages).toEqual(["SAVING:Saving your stage and country"]);
  });

  it("names whom Q is looking up from their own record, never the model's words", async () => {
    const world = founderWorld();
    const model = recordingModel(answers);
    const stages: string[] = [];
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
      founderResearch: {
        consider: () => true,
        offerReady: () => Promise.resolve(0),
        status: () => "IDLE" as never,
        unsaid: () => new Set(),
        markSaid: () => undefined,
        takeNote: () => null,
      },
    }).turn({
      ...turn(world, said),
      actor,
      onStage: (stage) => stages.push(`${stage.stage}:${stage.label}`),
    });
    expect(stages[0]).toBe("LOOKING_UP:Looking up Quillmark Health");
  });

  it("says what saved first, while the model writes the rest, and never twice", async () => {
    const world = founderWorld();
    const model = recordingModel([
      ...answers,
      { stepKey: "F4.team_size", value: 14, quote: "fourteen people" },
    ]);
    const sentences: string[] = [];
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({
      ...turn(world, said),
      actor,
      onSentence: (sentence) => sentences.push(sentence),
    });
    // The receipt is the first thing said, and the reply opens with it.
    expect(sentences[0]).toMatch(/Seed \(stage\)/);
    expect(sentences[0]).toMatch(/Kenya \(country\)/);
    expect(outcome.reply.startsWith(sentences[0] ?? "-")).toBe(true);
    expect(outcome.reply).toContain("The model's own reply.");
    expect(outcome.reply.split("Seed (stage)")).toHaveLength(2);
  });
});

describe("an exact answer is recorded and replied to by code, no model call (2026-10-21)", () => {
  /** Turn one: the model asks the stage. Every later call is counted. */
  function askingModel() {
    let calls = 0;
    const gateway = {
      execute: () => {
        calls += 1;
        return Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({
              reply: "What stage is Quillmark at?",
              asking: "F1.stage",
            }),
          },
        });
      },
    } as unknown as ModelGateway;
    return { gateway, calls: () => calls };
  }

  it("'Seed' after Q asked the stage: saved, then the next question, zero model calls", async () => {
    const world = founderWorld();
    const model = askingModel();
    const agent = createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({})),
      replyByCodeAfterCleanSave: true,
      readingByCodeWhereExact: true,
    });
    await agent.turn({ ...turn(world, "Hi, where do we start?"), actor });
    const before = model.calls();
    const outcome = await agent.turn({ ...turn(world, "Seed."), actor });
    expect(model.calls()).toBe(before);
    expect(world.recordedValue("F1.stage")).toBeDefined();
    expect(outcome.reply).toContain("Seed");
    expect(outcome.reply.trim().endsWith("?")).toBe(true);
  });

  it("a question code adds carries its step, so its options show", async () => {
    const world = founderWorld();
    const gateway = {
      execute: () =>
        Promise.resolve({
          output: {
            kind: "TEXT",
            text: JSON.stringify({ reply: "Thanks for that.", asking: null }),
          },
        }),
    } as unknown as ModelGateway;
    const outcome = await createInterviewAgent({
      gateway,
      firewall,
      logger,
      delegation: readerOf(reading({})),
    }).turn({
      ...turn(
        world,
        "We build scheduling and billing software for small clinics in the region, and it is going well.",
      ),
      actor,
    });
    // Code added the next question; the screen gets that step and options.
    expect(outcome.reply).not.toBe("Thanks for that.");
    expect(outcome.askingAbout).toHaveLength(1);
    expect(outcome.asking?.stepKey).toBe(outcome.askingAbout?.[0]);
  });

  it("without the code reply composed, the model still writes it", async () => {
    const world = founderWorld();
    const model = askingModel();
    const agent = createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({})),
      readingByCodeWhereExact: true,
    });
    await agent.turn({ ...turn(world, "Hi, where do we start?"), actor });
    const before = model.calls();
    await agent.turn({ ...turn(world, "Seed."), actor });
    expect(model.calls()).toBeGreaterThan(before);
  });
});

describe("no closing reply while a stated fact is unsaved (live AF 2026-10-16)", () => {
  it("a step the reading found stated, not yet written, gets another model round", async () => {
    const world = founderWorld();
    // Two figures: code cannot tell which is the amount, so the model does.
    const said =
      "Seed stage, based in Kenya, raising half a million, 12 people.";
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
      { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
    ]);
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(
        reading({ stated: ["F1.stage", "F1.country", "F6.target_amount"] }),
      ),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBe(2);
  });

  it("one figure for the one stated amount: code records it, no second round", async () => {
    const world = founderWorld();
    const said = "Seed stage, based in Kenya, raising half a million.";
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
      { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(
        reading({ stated: ["F1.stage", "F1.country", "F6.target_amount"] }),
      ),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    const amount = world.recordedValue("F6.target_amount");
    expect(amount?.type === "RANGE" ? Number(amount.value) : null).toBe(
      500_000,
    );
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toMatch(/500,000|500000/u);
  });
});

describe("a stated step off their path never holds the code reply (live 25 Oct e2e)", () => {
  it("the paying-customers count of a seed company: one model round, code replies", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.website",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Quillmark Health",
      },
      ineligible: ["F5.customers"],
      taxonomy: { kenya: countryOfIso("KE")?.nodeId ?? "" },
    });
    const said = "Seed stage, based in Kenya, with 210 paying customers.";
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
      { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      // The reading found the count stated; a seed company's path has no
      // step for it until its signal is "Paying customers".
      delegation: readerOf(
        reading({ stated: ["F1.stage", "F1.country", "F5.customers"] }),
      ),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toContain("Seed (stage)");
    expect(world.recordedValue("F5.customers")).toBeUndefined();
  });
});

describe("a code receipt is never cut by the claim guard (live AL)", () => {
  it("keeps the receipt that quotes a long description", async () => {
    const world = founderWorld();
    const said =
      "We make solar cold rooms for market traders in Accra and Kumasi, rented by the day.";
    const model = recordingModel([
      { stepKey: "F1.description", value: said, quote: said },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.description"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toMatch(/We make solar cold rooms/u);
  });
});

describe("a refusal later put right in the same turn does not hold the reply (live AP)", () => {
  it("amount refused for its scale, saved by code: one model round, code writes the reply", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F6.raising",
      recorded: { "F0.intent": "raising_now", "F1.company_name": "Tidewell" },
    });
    const said =
      "Yes, we're actively raising about 750 thousand dollars on a SAFE.";
    const model = recordingModel([
      { stepKey: "F6.raising", value: "active", quote: "actively raising" },
      {
        stepKey: "F6.target_amount",
        value: 750,
        quote: "750 thousand dollars",
      },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(
        reading({ stated: ["F6.raising", "F6.target_amount"] }),
      ),
      replyByCodeAfterCleanSave: true,
    }).turn({ ...turn(world, said), actor });
    const amount = world.recordedValue("F6.target_amount");
    expect(amount?.type === "RANGE" ? Number(amount.value) : null).toBe(
      750_000,
    );
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toMatch(/750,000/u);
  });

  it("the same answer again is not written again", async () => {
    const world = founderWorld();
    const said = "We're seed stage.";
    const port = createOnboardingPort({
      session: turn(world, said).session,
      onboardingSessionId: turn(world, said).onboardingSessionId,
      journeyType: "founder",
      ownerUserId: actor.userId,
      personTurns: [said],
    });
    await port.record([
      {
        stepKey: "F1.stage",
        value: "seed",
        quote: "seed stage",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    const before = world.attempts().length;
    const [again] = await port.record([
      {
        stepKey: "F1.stage",
        value: "seed",
        quote: "seed stage",
        basis: "STATED",
        ownWords: false,
      },
    ]);
    expect(again?.outcome).toBe("COMMITTED");
    expect(world.attempts().length).toBe(before);
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
      "Got it, I've saved Seed (stage) and 14 (team size). What does the company do?",
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

describe("codeReading: a few plain words for an asked text step (live 2026-10-16)", () => {
  const title = INVESTOR_DEFINITION_V1.steps.find(
    (s) => s.stepKey === "I0.business_title",
  );

  it("'Partner.' states the title", () => {
    expect(
      codeReading({
        utterance: "Partner.",
        asked: title,
        pendingCount: 0,
      })?.stated.has("I0.business_title"),
    ).toBe(true);
  });

  it("a decline, a deferral, a delegation, a greeting or a question is the reader's", () => {
    for (const utterance of [
      "skip",
      "not sure",
      "rather not say",
      "you pick",
      "later",
      "hello",
      "Partner?",
      "Partner and also our main strategy",
    ]) {
      expect(
        codeReading({ utterance, asked: title, pendingCount: 0 }),
        utterance,
      ).toBeNull();
    }
  });
});

describe("the journey's own platform step is never put to the person", () => {
  it("the mandate reference step is not in the state Q reads", async () => {
    const world = investorSession({ currentStepKey: "I0.business_title" });
    const port = createOnboardingPort({
      session: turn(world, "").session,
      onboardingSessionId: turn(world, "").onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
    });
    const state = await port.state();
    expect(state.steps.map((s) => s.stepKey)).not.toContain(
      "I1.mandate_context",
    );
  });
});

describe("the reply is in their language (ob1 live on AF)", () => {
  const standingIn = (language: string): StandingStore => ({
    read: () =>
      Promise.resolve({
        personality: "AUTO",
        language: language as never,
        conduct: INITIAL_CONDUCT,
      }),
    saveConduct: () => Promise.resolve(),
    setPersonality: () => Promise.resolve(),
    setLanguage: () => Promise.resolve(),
    suspend: () => Promise.resolve(false),
  });
  /** What the model was told, as one string. */
  const toldOf = (gateway: ModelGateway) => {
    const seen: string[] = [];
    const execute = gateway.execute.bind(gateway);
    (gateway as { execute: unknown }).execute = (request: {
      messages: { content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      return execute(request as never);
    };
    return seen;
  };

  it("Automatic and a French turn: the model answers, told to use their language, no English added", async () => {
    const world = founderWorld();
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "phase d'amorçage" },
    ]);
    const told = toldOf(model.gateway);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage"] })),
      replyByCodeAfterCleanSave: true,
    }).turn({
      ...turn(world, "Nous sommes en phase d'amorçage, basés à Nairobi."),
      actor,
    });
    expect(model.calls()).toBe(2);
    expect(told.join("\n")).toContain(
      "THEIR LANGUAGE: their latest words are not in English",
    );
    expect(outcome.reply).toBe("The model's own reply. What else?");
  });

  it("a chosen language with its copy translated: code writes the reply in it, one model round", async () => {
    const world = founderWorld();
    const model = recordingModel(answers());
    const asked: { texts: readonly string[]; cachedOnly: boolean }[] = [];
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
      standing: standingIn("fr"),
      localiseWords: (_actor, _language, texts, options) => {
        asked.push({ texts, cachedOnly: options?.cachedOnly === true });
        return Promise.resolve(texts.map((text) => `[fr] ${text}`));
      },
    }).turn({ ...turn(world, "Seed stage, based in Kenya."), actor });
    expect(model.calls()).toBe(1);
    // Only product copy was sent for translation, and without waiting.
    expect(asked[0]?.cachedOnly).toBe(true);
    expect(asked[0]?.texts).toContain("stage");
    expect(asked.flatMap((a) => a.texts)).toContain("Seed");
    expect(asked[0]?.texts.join("\n")).not.toMatch(/Seed stage|based in/u);
    expect(outcome.reply).toMatch(
      /^\[fr\] [^:]+: \[fr\] stage: \[fr\] Seed; /u,
    );
    // No English line is left over in the reply.
    expect(outcome.reply.replace(/\[fr\][^;:.?]*/gu, "")).not.toMatch(
      /[a-z]{4,}/u,
    );
  });

  it("a chosen language whose copy is not translated yet: the model replies, nothing English is written by code", async () => {
    const world = founderWorld();
    const model = recordingModel(answers());
    const told = toldOf(model.gateway);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
      standing: standingIn("fr"),
      localiseWords: (_actor, _language, texts, options) =>
        Promise.resolve(
          texts.map((text) =>
            options?.cachedOnly === true ? null : `[fr] ${text}`,
          ),
        ),
    }).turn({ ...turn(world, "Seed stage, based in Kenya."), actor });
    expect(model.calls()).toBe(2);
    expect(told.join("\n")).toMatch(/this person chose French/u);
    expect(outcome.reply).not.toMatch(
      /Got it, saved|on your record|Noted and saved|Great, saved/u,
    );
  });

  it("Arabic chosen: the hand-written question is used and their own words are read back exactly", async () => {
    const world = founderWorld();
    const model = recordingModel([
      { stepKey: "F1.stage", value: "seed", quote: "مرحلة البذرة" },
    ]);
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage"] })),
      replyByCodeAfterCleanSave: true,
      standing: standingIn("ar"),
      localiseWords: (_actor, _language, texts) =>
        Promise.resolve(texts.map((text) => `«${text.length}»`)),
    }).turn({ ...turn(world, "نحن في مرحلة البذرة"), actor });
    expect(model.calls()).toBe(1);
    expect(outcome.reply).not.toMatch(/[A-Za-z]{3,}/u);
    expect(outcome.reply).toMatch(/[\u0600-\u06FF]/u);
  });

  it("Automatic and a turn not in English: still the model's reply (no language tag to translate to)", async () => {
    const world = founderWorld();
    const model = recordingModel(answers());
    let asked = 0;
    await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
      standing: standingIn("AUTO"),
      localiseWords: (_actor, _language, texts) => {
        asked += 1;
        return Promise.resolve(texts.map((text) => `[x] ${text}`));
      },
    }).turn({
      ...turn(world, "Nous sommes en phase d'amorçage, basés au Kenya."),
      actor,
    });
    expect(model.calls()).toBe(2);
    expect(asked).toBe(0);
  });

  it("Automatic and an English turn keep the quick English reply", async () => {
    const world = founderWorld();
    const model = recordingModel(answers());
    const outcome = await createInterviewAgent({
      gateway: model.gateway,
      firewall,
      logger,
      delegation: readerOf(reading({ stated: ["F1.stage", "F1.country"] })),
      replyByCodeAfterCleanSave: true,
      standing: standingIn("AUTO"),
    }).turn({ ...turn(world, "Seed stage, based in Kenya."), actor });
    expect(model.calls()).toBe(1);
    expect(outcome.reply).toContain("Seed (stage)");
  });

  function answers() {
    return [
      { stepKey: "F1.stage", value: "seed", quote: "Seed stage" },
      { stepKey: "F1.country", value: "Kenya", quote: "based in Kenya" },
    ];
  }
});
