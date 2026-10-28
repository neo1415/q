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
import { withStillSaving } from "../src/voice/onboarding-flow.js";

import { readerOf, reading } from "./authority-fixtures.js";
import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Typed onboarding, production re-test 2026-10-28 16:43-16:58 UTC (deployed
 * 83dda7a31; investor session f46ddb69, founder 38916a94). Each case is one
 * defect, with a fake model saying what the live one did.
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

function heldStore(repository: PendingWriteRepository) {
  let keys = 0;
  return createHeldWritesStore({
    sql: {} as never,
    repository,
    newKey: () => `10000000-0000-4000-8000-${String(++keys).padStart(12, "0")}`,
  });
}

const FIRM = {
  type: "INVESTOR_ORGANISATION" as const,
  id: "e0000000-0000-4000-8000-000000000001",
};

const MANDATE =
  "website harmattanangels.com, I'm actively investing, pre-seed and seed, cheques in dollars from 50k, typically 75k, up to 100k, we like to lead sometimes but mostly follow, stick closely to my mandate, I'm the managing partner";

describe("D1: one failing save never holds back the rest (live f46ddb69: I0.website HTTP_500 x7, nine answers PENDING)", () => {
  it("a website that fails with nine other answers: nine committed, the reply names the one still saving and never calls it kept", async () => {
    const world = investorSession({
      currentStepKey: "I0.website",
      subject: FIRM,
      recorded: {
        "I0.investor_type": "angel",
        "I0.organisation_name": "Harmattan Angels",
      },
      failing: ["I0.website"],
    });
    const repository = memoryPendingWrites();
    const answers = [
      ["I0.website", "harmattanangels.com", "website harmattanangels.com"],
      ["I1.deployment_status", "actively_investing", "I'm actively investing"],
      ["I2.stages", ["pre_seed", "seed"], "pre-seed and seed"],
      ["I2.currency", "usd", "cheques in dollars"],
      ["I2.cheque_min", 50000, "from 50k"],
      ["I2.cheque_typical", 75000, "typically 75k"],
      ["I2.cheque_max", 100000, "up to 100k"],
      [
        "I2.investment_role",
        ["lead", "co_invest"],
        "we like to lead sometimes but mostly follow",
      ],
      ["I9.discovery_mode", "strict", "stick closely to my mandate"],
      ["I0.business_title", "Managing partner", "I'm the managing partner"],
    ] as const;
    const { gateway } = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: answers.map(([stepKey, value, quote]) => ({
                stepKey,
                value,
                quote,
              })),
            },
          },
        ],
      },
      {
        reply:
          "Got it. Your website is kept. Which sectors do you invest in?",
        asking: "I3.sectors",
      },
    ]);
    const outcome = await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      heldWrites: heldStore(repository),
      recommendations: world.recommendations,
      delegation: readerOf(
        reading({ stated: answers.map(([stepKey]) => stepKey) }),
      ),
    }).turn({ ...turn(world, MANDATE), actor });

    const saved = answers
      .map(([stepKey]) => stepKey)
      .filter((key) => world.recordedValue(key) !== undefined);
    expect(saved).toHaveLength(9);
    expect(world.recordedValue("I0.website")).toBeUndefined();
    expect(
      repository
        .rows()
        .filter((r) => r.status === "PENDING")
        .map((r) => r.stepKey),
    ).toEqual(["I0.website"]);
    // "mostly follow" is co-investing behind a lead: the reading's choice
    // stands, never cut back to the one option whose label it repeats.
    expect(world.recordedValue("I2.investment_role")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["lead", "co_invest"],
    });
    expect(outcome.reply).not.toMatch(/website is kept/iu);
    expect(outcome.reply).toMatch(/Still saving your firm website/u);
    expect(outcome.reply).toMatch(/\?$/u);
  });

  it("withStillSaving: takes out a kept/saved claim naming a queued field, keeps the question last", () => {
    expect(
      withStillSaving(
        "Your $50k–$100k cheque range is kept. Harmattan Angels is set up. Which sectors?",
        ["Minimum cheque"],
      ),
    ).toBe(
      "Harmattan Angels is set up. Still saving your minimum cheque; I'll confirm once it's in. Which sectors?",
    );
    expect(withStillSaving("Thanks.", [])).toBe("Thanks.");
  });
});
