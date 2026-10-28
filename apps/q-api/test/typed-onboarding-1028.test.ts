import { describe, expect, it } from "vitest";

import type {
  OnboardingSessionView,
  PermittedContextPlan,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type {
  PendingWrite,
  PendingWriteRepository,
} from "@capital-q/onboarding";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createHeldWritesStore } from "../src/voice/held-writes.js";
import {
  createInterviewAgent,
  stoppingIsFinishing,
} from "../src/voice/interview-agent.js";
import {
  describeValue,
  recordedCurrency,
} from "../src/voice/interview-steps.js";
import { finishingLine } from "../src/voice/onboarding-flow.js";
import { fieldClausesOf } from "../src/voice/onboarding-port.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Typed onboarding, live on production 2026-10-28 (sessions ca3626ab,
 * investor; 7982610e, founder). What a brand-new person typed was lost,
 * mangled, re-asked or paused, never finished. Each case here is one of
 * those defects, with a fake model saying exactly what the live one did.
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

type Scripted =
  | { readonly calls: readonly { name: string; arguments: unknown }[] }
  | { readonly reply: string; readonly asking?: string | null };

/** A model that says, round by round, what the live one said. */
function model(script: readonly Scripted[]) {
  const seen: string[] = [];
  let index = 0;
  const gateway = {
    execute: (request: {
      readonly messages: readonly { readonly content: string }[];
    }) => {
      seen.push(request.messages.map((m) => m.content).join("\n"));
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      if (step !== undefined && "calls" in step) {
        return Promise.resolve({
          output: {
            kind: "TOOL_CALLS",
            text: "",
            calls: step.calls.map((c, i) => ({
              callId: `call_${String(index)}_${String(i)}`,
              name: c.name,
              arguments: c.arguments,
            })),
          },
        });
      }
      return Promise.resolve({
        output: {
          kind: "TEXT",
          text: JSON.stringify({
            reply: step?.reply ?? "",
            asking: step?.asking ?? null,
          }),
        },
      });
    },
    rounds: () => index,
  } as unknown as ModelGateway & { rounds: () => number };
  return { gateway, seen };
}

function memoryPendingWrites(): PendingWriteRepository & {
  readonly rows: () => readonly (PendingWrite & { status: string })[];
} {
  const rows: (PendingWrite & { status: string })[] = [];
  return {
    rows: () => rows,
    hold: (_sql, input) => {
      for (const r of rows) {
        if (
          r.sessionId === input.sessionId &&
          r.stepKey === input.stepKey &&
          r.status === "PENDING"
        ) {
          r.status = "DISCARDED";
        }
      }
      const row = {
        ...input,
        id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
        attempts: 0,
        createdAt: new Date(),
        status: "PENDING",
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    listPending: (_sql, sessionId, userId) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            r.sessionId === sessionId &&
            r.userId === userId &&
            r.status === "PENDING",
        ),
      ),
    settle: (_sql, id, status) => {
      const row = rows.find((r) => r.id === id && r.status === "PENDING");
      if (row !== undefined) row.status = status;
      return Promise.resolve();
    },
    recordAttempt: () => Promise.resolve(),
  };
}

function heldStore(repository: PendingWriteRepository) {
  let keys = 0;
  return createHeldWritesStore({
    sql: {} as never,
    repository,
    newKey: () => `10000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
  });
}

const INTRO =
  "I'm an angel, also run a small syndicate called Harmattan Angels, website harmattanangels.com, pre-seed and seed, Nigeria Ghana Kenya, fintech and health, cheques 25 to 100k dollars, I'm actively investing";

describe("D1: an investor's whole first sentence is saved (live ca3626ab, 10:39:19)", () => {
  it("hands the investor type back with its options instead of saving the sentence, so the firm is set up and every other answer lands", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      // The real journey: the firm exists once its name and how they
      // invest are both on the record; every other answer needs the firm.
      setUpBy: ["I0.investor_type", "I0.organisation_name"],
    });
    const repository = memoryPendingWrites();
    const store = heldStore(repository);
    const stated = [
      "I0.investor_type",
      "I0.organisation_name",
      "I0.website",
      "I1.deployment_status",
      "I2.stages",
      "I2.currency",
      "I2.cheque_min",
      "I2.cheque_max",
    ];
    const first = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I0.investor_type",
                  // What the live model recorded: the sentence, not an option.
                  value:
                    "I'm an angel, also run a small syndicate called Harmattan Angels",
                  quote:
                    "I'm an angel, also run a small syndicate called Harmattan Angels",
                },
                {
                  stepKey: "I0.organisation_name",
                  value: "Harmattan Angels",
                  quote: "a small syndicate called Harmattan Angels",
                },
                {
                  stepKey: "I0.website",
                  value: "harmattanangels.com",
                  quote: "website harmattanangels.com",
                },
                {
                  stepKey: "I1.deployment_status",
                  value: "actively_investing",
                  quote: "I'm actively investing",
                },
                {
                  stepKey: "I2.stages",
                  value: ["pre_seed", "seed"],
                  quote: "pre-seed and seed",
                },
                {
                  stepKey: "I2.currency",
                  value: "usd",
                  quote: "cheques 25 to 100k dollars",
                },
                {
                  stepKey: "I2.cheque_min",
                  value: 25000,
                  quote: "cheques 25 to 100k dollars",
                },
                {
                  stepKey: "I2.cheque_max",
                  value: 100000,
                  quote: "cheques 25 to 100k dollars",
                },
              ],
            },
          },
        ],
      },
      {
        // Told the options, the model reads which one is meant.
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I0.investor_type",
                  value: "angel",
                  quote: "I'm an angel",
                },
              ],
            },
          },
        ],
      },
      {
        reply:
          "Got it. When I show you companies, should I stick closely to this mandate, or include a few interesting ones just outside it?",
        asking: "I9.discovery_mode",
      },
    ]);
    const agent = createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated })),
    });
    const outcome = await agent.turn({ ...turn(world, INTRO), actor });

    expect(world.recordedValue("I0.investor_type")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "angel",
    });
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Harmattan Angels",
    });
    expect(world.recordedValue("I1.deployment_status")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "actively_investing",
    });
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "25000",
    });
    expect(world.recordedValue("I2.cheque_max")).toEqual({
      type: "RANGE",
      value: "100000",
    });
    expect(world.recordedValue("I2.currency")).toBeDefined();
    expect(world.recordedValue("I0.website")).toBeDefined();
    // Seven or more steps from one sentence, and nothing left waiting.
    expect(outcome.recorded.length).toBeGreaterThanOrEqual(7);
    expect(repository.rows().filter((r) => r.status === "PENDING")).toEqual([]);
    expect(outcome.reply).not.toMatch(/haven't saved/u);
    // Two recording rounds: the sentence handed back, then the option.
    expect(first.seen.length).toBeGreaterThanOrEqual(3);

    // The correction supersedes the minimum cheque.
    const second = model([
      {
        calls: [
          {
            name: "correct_answer",
            arguments: {
              corrections: [
                {
                  stepKey: "I2.cheque_min",
                  value: 50000,
                  quote: "make that 50 to 100k, not 25",
                },
              ],
            },
          },
        ],
      },
      {
        reply:
          "Changed: your cheques are now 50 to 100k. When I show you companies, should I stick closely to this mandate, or include a few just outside it?",
        asking: "I9.discovery_mode",
      },
    ]);
    const corrected = await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ stated: ["I2.cheque_min"] })),
    }).turn({
      ...turn(world, "actually sorry, make that 50 to 100k, not 25"),
      actor,
    });
    expect(world.recordedValue("I2.cheque_min")).toEqual({
      type: "RANGE",
      value: "50000",
    });
    expect(corrected.reply).not.toMatch(/haven't saved/u);

    // Something said that fills no step is never answered with "I haven't
    // saved that yet": the unbacked claim goes, and nothing is said instead.
    const third = model([
      {
        reply:
          "About six deals a year is useful context. Noted. Which stages do you like to back?",
        asking: "I2.stages",
      },
    ]);
    const aside = await createInterviewAgent({
      gateway: third.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
      recommendations: world.recommendations,
      delegation: readerOf(reading({})),
    }).turn({
      ...turn(
        world,
        "ok I'm back. we do about 6 deals a year and we like to lead sometimes but mostly follow",
      ),
      actor,
    });
    expect(aside.reply).not.toMatch(/haven't saved/u);
    expect(aside.reply).not.toMatch(/\bNoted\b/u);
  });
});

describe("D3: 'that's all for now' finishes, or says exactly what is still needed (live ca3626ab, 10:40:50)", () => {
  it("reads stopping as finishing on the typed channel, and leaves the spoken reading alone", () => {
    expect(stoppingIsFinishing(reading({ pausing: true }))).toMatchObject({
      finishing: true,
      pausing: false,
    });
    expect(stoppingIsFinishing(reading({ finishing: true }))).toMatchObject({
      finishing: true,
    });
    expect(stoppingIsFinishing(reading({}))).toMatchObject({
      finishing: false,
      pausing: false,
    });
    expect(stoppingIsFinishing(null)).toBeNull();
  });

  it("with essentials open: one line naming the required things still open, the first of them asked, and nobody moved to Home", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
        "I1.deployment_status": "actively_investing",
      },
    });
    const { gateway } = model([
      {
        reply:
          "Understood. We'll stop here and pick up later; your answers are kept.",
      },
    ]);
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      // Read as pausing, as the live reader read "that's all for now".
      delegation: readerOf(reading({ pausing: true })),
    }).turn({ ...turn(world, "that's all for now"), actor });
    expect(outcome.navigate).toBeNull();
    expect(outcome.pausing).toBeUndefined();
    expect(outcome.reply).toMatch(/^Before I can finish, I still need /u);
    expect(outcome.reply).not.toMatch(/pause|stop here|pick up later/iu);
    expect(outcome.reply).toMatch(/stages/u);
    expect(outcome.reply).toMatch(/\?$/u);
    expect(outcome.asking?.stepKey).toBe("I2.stages");
    expect(outcome.view.session.status).toBe("ACTIVE");
  });

  it("with every required answer on the record: the review is confirmed on their word and the setup completes", async () => {
    const required = INVESTOR_DEFINITION_V1.steps.filter(
      (step) => step.required,
    );
    const recorded: Record<string, string> = {};
    for (const step of required) {
      const c = step.configuration;
      recorded[step.stepKey] =
        c.stepType === "single_select" || c.stepType === "multi_select"
          ? (c.options[0]?.optionKey ?? "")
          : c.stepType === "confirmation"
            ? "true"
            : c.stepType === "reference_select"
              ? "d0000000-0000-4000-8000-000000000001"
              : c.stepType === "range"
                ? "10"
                : "Harmattan Angels";
    }
    const world = investorSession({
      currentStepKey: "I11.review",
      recorded,
      subject: {
        type: "INVESTOR_ORGANISATION",
        id: "e0000000-0000-4000-8000-000000000001",
      },
    });
    const { gateway } = model([{ reply: "Understood, we'll pause here." }]);
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(reading({ finishing: true })),
    }).turn({ ...turn(world, "finish"), actor });
    expect(outcome.view.session.status).toBe("COMPLETED");
    expect(outcome.navigate).toBe("DISCOVER");
    expect(outcome.reply).toMatch(/saved and live/u);
    expect(outcome.reply).not.toMatch(/pause/iu);
  });

  it("says the open things in one line, by label, and asks the first", () => {
    const line = finishingLine(
      "investor",
      {
        completed: false,
        missing: [
          { stepKey: "I2.stages", question: "Which stages?" },
          { stepKey: "I9.discovery_mode", question: "Strict or broad?" },
        ],
      },
      {
        labelOf: (key) => (key === "I2.stages" ? "Stages" : undefined),
        questionOf: (key) =>
          key === "I2.stages" ? "Which stages do you like to back?" : null,
      },
    );
    expect(line).toEqual({
      reply:
        "Before I can finish, I still need 2 things: stages and Strict or broad?. Which stages do you like to back?",
      asking: "I2.stages",
    });
  });
});

describe("D4: a founder's figures keep their decimal, their currency and their unit (live 7982610e)", () => {
  it("does not split 'KSh 2.1m' at its decimal point", () => {
    const quote =
      "we're at https://ajalihealth.co.ke, based in Kenya, pre-seed, three founders and I'm the CEO, raising 400k dollars, we have about 1,200 paying users, revenue about KSh 2.1m a month";
    expect(fieldClausesOf(quote, "monthly revenue KSh 2.1m")).toBe(
      "revenue about KSh 2.1m a month",
    );
    expect(fieldClausesOf(quote, "revenue")).not.toContain("2.;");
  });

  it("reads a money step back in its own phase's currency, not the raise's", () => {
    const steps = new Map(
      FOUNDER_DEFINITION_CURRENT.steps.map((s) => [s.stepKey, s] as const),
    );
    const view = {
      responses: [
        {
          stepKey: "F6.currency",
          value: { type: "SINGLE_SELECT", optionKey: "usd" },
        },
        {
          stepKey: "F5.fin_currency",
          value: { type: "SINGLE_SELECT", optionKey: "kes" },
        },
      ],
    } as unknown as OnboardingSessionView;
    expect(recordedCurrency(view, steps, "F5.monthly_revenue")).toBe("kes");
    expect(recordedCurrency(view, steps, "F6.target_amount")).toBe("usd");
    // With no phase named, the journey's first currency, as before.
    expect(recordedCurrency(view, steps)).toBe("usd");
    const margin = steps.get("F5.gross_margin");
    expect(margin).toBeDefined();
    expect(describeValue(margin, { type: "RANGE", value: "61" })).toBe("61%");
  });

  it("saves the raise amount the turn it is said, although 'raising' lands in the same batch", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.website",
      recorded: { "F1.company_name": "Ajali Health" },
      // The amount opens on their path only once they say they are raising.
      opensAfter: { "F6.target_amount": "F6.raising" },
    });
    const repository = memoryPendingWrites();
    const store = heldStore(repository);
    const { gateway } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "F6.target_amount",
                  value: 400000,
                  quote: "raising 400k dollars",
                },
                {
                  stepKey: "F6.raising",
                  value: "active",
                  quote: "raising 400k dollars",
                },
              ],
            },
          },
        ],
      },
      { reply: "Got it. What's your website?", asking: "F1.website" },
    ]);
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
      recommendations: world.recommendations,
      delegation: readerOf(
        reading({ stated: ["F6.target_amount", "F6.raising"] }),
      ),
    }).turn({ ...turn(world, "we're raising 400k dollars"), actor });
    expect(world.recordedValue("F6.raising")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "active",
    });
    expect(world.recordedValue("F6.target_amount")).toEqual({
      type: "RANGE",
      value: "400000",
    });
    expect(repository.rows().filter((r) => r.status === "PENDING")).toEqual([]);
  });
});

describe("D5: a required step they set aside stays set aside across an interruption (live ca3626ab, 10:40:29)", () => {
  it("is not asked again this conversation, by the model's reply or by code's next question", async () => {
    const world = investorSession({
      currentStepKey: "I9.discovery_mode",
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
        "I1.deployment_status": "actively_investing",
        "I2.stages": "seed",
        "I2.currency": "usd",
      },
    });
    const readings = [
      reading({ declined: ["I9.discovery_mode"] }),
      reading({}),
    ];
    const { gateway } = model([
      { reply: "No problem, we can leave that one for now." },
      { reply: "No problem, take your time." },
    ]);
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      delegation: readerOf(() => readings.shift() ?? reading({})),
    });
    const skipped = await agent.turn({
      ...turn(world, "skip that one"),
      actor,
    });
    expect(skipped.asking?.stepKey).not.toBe("I9.discovery_mode");
    expect(skipped.reply).not.toMatch(/stick closely/u);
    expect(skipped.reply).not.toMatch(/haven't saved/u);
    const back = await agent.turn({
      ...turn(world, "hold on, my dog is barking"),
      actor,
    });
    expect(back.asking?.stepKey).not.toBe("I9.discovery_mode");
    expect(back.reply).not.toMatch(/stick closely/u);
    expect(back.reply).not.toMatch(/haven't saved/u);
  });
});
