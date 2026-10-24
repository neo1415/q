import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type {
  PendingWrite,
  PendingWriteRepository,
} from "@capital-q/onboarding";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createHeldWritesStore } from "../src/voice/held-writes.js";
import { createInterviewAgent } from "../src/voice/interview-agent.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * F-52 (production QA 2026-10-23): a new investor's first answer named the
 * firm and its whole mandate, without saying how they invest. The firm
 * could not be set up yet (it needs how they invest), every other answer
 * needs the firm, and all of it was refused and lost: "I couldn't save
 * those details because the firm context isn't active yet", 0/9.
 *
 * Now the firm's name is kept on its own, each answer that needs the firm
 * is refused alone and kept, and all of it is saved by itself the turn the
 * firm comes to exist.
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
  | { readonly reply: string };

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
          text: JSON.stringify({ reply: step?.reply ?? "", asking: null }),
        },
      });
    },
  } as unknown as ModelGateway;
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

const FIRST =
  "Haddad Desert Ventures. I'm a partner. We write seed cheques into fintech and climate.";

describe("F-52: a new investor's first answer is never lost to the firm not being set up yet", () => {
  it("keeps every early answer, says none is saved, and saves them all the turn how they invest is known", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      // The real journey: the firm is set up once its name and how they
      // invest are both known; every other answer needs the firm.
      setUpBy: ["I0.investor_type", "I0.organisation_name"],
    });
    const repository = memoryPendingWrites();
    let keys = 0;
    const store = createHeldWritesStore({
      sql: {} as never,
      repository,
      newKey: () =>
        `10000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
    });

    const first = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I0.organisation_name",
                  value: "Haddad Desert Ventures",
                  quote: "Haddad Desert Ventures",
                },
                {
                  stepKey: "I0.business_title",
                  value: "Partner",
                  quote: "I'm a partner",
                },
                {
                  stepKey: "I2.stages",
                  value: "Seed",
                  quote: "We write seed cheques",
                },
              ],
            },
          },
        ],
      },
      {
        reply:
          "Got it. How do you invest: a fund, as an angel, or another way?",
      },
    ]);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({ ...turn(world, FIRST), actor });

    // The name is kept on its own; nothing else is on the record, and
    // nothing is claimed as saved...
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Haddad Desert Ventures",
    });
    expect(world.recordedValue("I2.stages")).toBeUndefined();
    const toolResults = first.seen.join("\n");
    expect(toolResults).toContain("HELD_FOR_RETRY");
    expect(toolResults).toContain("Kept, and saved automatically");
    expect(toolResults).not.toContain("context isn't active");
    // ...but every answer is kept, none refused and dropped.
    expect(
      repository
        .rows()
        .filter((r) => r.status === "PENDING")
        .map((r) => r.stepKey)
        .sort(),
    ).toEqual(["I0.business_title", "I2.stages"]);

    // Turn two: how they invest. Everything kept lands in the same turn.
    const second = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I0.investor_type",
                  value: "VC",
                  quote: "We're a VC fund",
                },
              ],
            },
          },
        ],
      },
      { reply: "Thanks, that's all saved." },
    ]);
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({ ...turn(world, "We're a VC fund."), actor });

    // Before turn two's own answer, the model was told what is kept and
    // why (never "a service is unavailable"), so it asks none of it again.
    expect(second.seen[0]).toContain(
      "NOT saved yet because another answer comes first",
    );
    expect(second.seen[0]).not.toContain("briefly unavailable");
    expect(world.recordedValue("I0.investor_type")).toBeDefined();
    expect(world.recordedValue("I0.organisation_name")).toEqual({
      type: "TEXT",
      text: "Haddad Desert Ventures",
    });
    expect(world.recordedValue("I0.business_title")).toBeDefined();
    expect(world.recordedValue("I2.stages")).toBeDefined();
    expect(repository.rows().filter((r) => r.status === "PENDING")).toEqual([]);
  });
});

describe("F-52: an answer kept early never overwrites a newer one", () => {
  it("settles the kept answer without writing it when they restate it the turn the firm lands", async () => {
    const world = investorSession({
      currentStepKey: "I0.investor_type",
      setUpBy: ["I0.investor_type", "I0.organisation_name"],
    });
    const repository = memoryPendingWrites();
    let keys = 0;
    const store = createHeldWritesStore({
      sql: {} as never,
      repository,
      newKey: () =>
        `20000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
    });
    const record = (
      answers: readonly { stepKey: string; value: string; quote: string }[],
      reply: string,
    ) =>
      model([
        { calls: [{ name: "record_answers", arguments: { answers } }] },
        { reply },
      ]);
    const first = record(
      [
        {
          stepKey: "I0.organisation_name",
          value: "Haddad Desert Ventures",
          quote: "Haddad Desert Ventures",
        },
        { stepKey: "I2.stages", value: "Seed", quote: "seed cheques" },
      ],
      "How do you invest?",
    );
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...turn(world, "Haddad Desert Ventures, seed cheques."),
      actor,
    });
    const second = record(
      [
        { stepKey: "I0.investor_type", value: "VC", quote: "a VC fund" },
        {
          stepKey: "I2.stages",
          value: "Pre-seed",
          quote: "actually pre-seed",
        },
      ],
      "Saved.",
    );
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...turn(world, "We're a VC fund, and actually pre-seed."),
      actor,
    });
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed"],
    });
    expect(repository.rows().filter((r) => r.status === "PENDING")).toEqual([]);
  });
});

describe("QO-26: a raise amount said before the raise question is saved, not asked again", () => {
  it("keeps it in their notes and held, then saves it to the amount the turn the step opens", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.description",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Kiln Payroll (fictional)",
      },
      // The journey's branching: the amount opens once they say they raise.
      opensAfter: { "F6.target_amount": "F6.raising" },
    });
    const repository = memoryPendingWrites();
    let keys = 0;
    const store = createHeldWritesStore({
      sql: {} as never,
      repository,
      newKey: () =>
        `30000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
    });
    const say = (
      answers: readonly { stepKey: string; value: unknown; quote: string }[],
    ) =>
      model([
        { calls: [{ name: "record_answers", arguments: { answers } }] },
        { reply: "Noted." },
      ]);
    const first = say([
      {
        stepKey: "F6.target_amount",
        value: 1_500_000,
        quote: "$1.5 million on a SAFE",
      },
    ]);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...turn(world, "We're putting together $1.5 million on a SAFE."),
      actor,
    });
    expect(world.recordedValue("F6.target_amount")).toBeUndefined();
    const notes = world.recordedValue("F7.follow_up");
    expect(notes?.type === "TEXT" ? notes.text : "").toContain("1.5");
    expect(
      repository
        .rows()
        .filter((r) => r.status === "PENDING")
        .map((r) => r.stepKey),
    ).toEqual(["F6.target_amount"]);

    const second = say([
      { stepKey: "F6.raising", value: "active", quote: "yes, actively" },
    ]);
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({ ...turn(world, "Yes, actively raising."), actor });
    expect(world.recordedValue("F6.target_amount")).toEqual({
      type: "RANGE",
      value: "1500000",
    });
    expect(repository.rows().filter((r) => r.status === "PENDING")).toEqual([]);
  });
});

describe("QO-28: a never-invest sentence is saved once, as its red flags", () => {
  it("does not also save the raw sentence as text when a sibling holds the concept", async () => {
    const world = investorSession({
      currentStepKey: "I7.hard_exclusions",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Benali Atlas Capital",
      },
    });
    const said = "We never invest in crypto, gambling or tobacco.";
    const turnModel = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I7.hard_exclusions",
                  value: ["Gambling", "Tobacco"],
                  quote: said,
                },
                {
                  stepKey: "I7.sector_exclusions",
                  value: "crypto, gambling or tobacco",
                  quote: said,
                },
              ],
            },
          },
        ],
      },
      { reply: "Noted." },
    ]);
    await createInterviewAgent({
      gateway: turnModel.gateway,
      firewall: firewall(),
      logger,
    }).turn({ ...turn(world, said), actor });
    expect(world.recordedValue("I7.hard_exclusions")?.type).toBe(
      "MULTI_SELECT",
    );
    expect(world.recordedValue("I7.sector_exclusions")).toBeUndefined();
  });
});

describe("QO-27: stages are the ones they named", () => {
  it("'pre-seed and seed' never saves Series A beside them", async () => {
    const world = investorSession({
      currentStepKey: "I2.stages",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Benali Atlas Capital",
      },
    });
    const said = "Pre-seed and seed.";
    const turnModel = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "I2.stages",
                  value: ["Pre-seed", "Seed", "Series A"],
                  quote: said,
                },
              ],
            },
          },
        ],
      },
      { reply: "Noted." },
    ]);
    await createInterviewAgent({
      gateway: turnModel.gateway,
      firewall: firewall(),
      logger,
    }).turn({ ...turn(world, said), actor });
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
  });
});

describe("QO-27: a geography said in two turns is both", () => {
  const UK = "c1000000-0000-4000-8000-000000000001";
  const WEST_AFRICA = "c1000000-0000-4000-8000-000000000002";
  const geography = async (
    wordsCheck?: () => Promise<"YES" | "NO" | "UNSURE" | null>,
  ) => {
    const world = investorSession({
      currentStepKey: "I3.geography",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Benali Atlas Capital",
      },
      taxonomy: { "the uk": UK, uk: UK, "west africa": WEST_AFRICA },
    });
    for (const [said, value] of [
      ["We invest in the UK.", "the UK"],
      ["And West Africa.", "West Africa"],
    ] as const) {
      const turnModel = model([
        {
          calls: [
            {
              name: "record_answers",
              arguments: {
                answers: [{ stepKey: "I3.geography", value, quote: said }],
              },
            },
          ],
        },
        { reply: "Noted." },
      ]);
      await createInterviewAgent({
        gateway: turnModel.gateway,
        firewall: firewall(),
        logger,
        ...(wordsCheck === undefined ? {} : { wordsCheck }),
      }).turn({ ...turn(world, said), actor });
    }
    const saved = world.recordedValue("I3.geography");
    return saved?.type === "RESOURCE_REFERENCE" ? saved.resourceIds : [];
  };

  it("adds, unless their words replace it", async () => {
    expect([...(await geography())].sort()).toEqual([UK, WEST_AFRICA].sort());
    expect([...(await geography(() => Promise.resolve("NO")))].sort()).toEqual(
      [UK, WEST_AFRICA].sort(),
    );
    // "Not the UK, West Africa": a correction, read by meaning.
    expect(await geography(() => Promise.resolve("YES"))).toEqual([
      WEST_AFRICA,
    ]);
  });
});

describe("QO-29: once the essentials are in, making the mandate live is asked next", () => {
  it("puts the review first, as a confirmation (their yes, never assumed)", async () => {
    const world = investorSession({
      currentStepKey: "I4.business_models",
      recorded: {
        "I0.investor_type": "vc",
        "I0.organisation_name": "Benali Atlas Capital",
        "I1.deployment_status": "actively_investing",
        "I2.stages": "pre_seed,seed",
        "I2.currency": "usd",
        "I3.geography": "c1000000-0000-4000-8000-000000000001",
        "I3.sectors": "c1000000-0000-4000-8000-000000000003",
        "I9.discovery_mode": "focused",
        "I10.inbound_preference": "open",
      },
    });
    const port = createOnboardingPort({
      session: turn(world, "").session,
      onboardingSessionId: turn(world, "").onboardingSessionId,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
    });
    const state = await port.state();
    expect(state.next?.[0]).toEqual({
      stepKey: "I11.review",
      reason: "CONFIRM_PROPOSAL",
    });
    expect(world.recordedValue("I11.review")).toBeUndefined();
  });
});

describe("QO-25: a role is their role now", () => {
  const role = async (
    said: string,
    check: () => Promise<"YES" | "NO" | "UNSURE" | null>,
  ) => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F4.founder_role",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Kiln Payroll (fictional)",
      },
    });
    const turnModel = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                { stepKey: "F4.founder_role", value: "product", quote: said },
              ],
            },
          },
        ],
      },
      { reply: "Noted." },
    ]);
    await createInterviewAgent({
      gateway: turnModel.gateway,
      firewall: firewall(),
      logger,
      wordsCheck: check,
    }).turn({ ...turn(world, said), actor });
    return world.recordedValue("F4.founder_role");
  };

  it("a past job is not saved as their role; a current one is", async () => {
    expect(
      await role("I was a product lead at Paystack.", () =>
        Promise.resolve("NO"),
      ),
    ).toBeUndefined();
    expect(
      await role("I lead product here.", () => Promise.resolve("YES")),
    ).toEqual({ type: "SINGLE_SELECT", optionKey: "cpo" });
  });
});
