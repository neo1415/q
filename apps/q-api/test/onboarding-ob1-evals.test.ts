import { afterAll, describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { founderCountryAnswer } from "@capital-q/founder-onboarding";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type {
  PendingWrite,
  PendingWriteRepository,
} from "@capital-q/onboarding";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import { createHeldWritesStore } from "../src/voice/held-writes.js";
import { createInterviewAgent } from "../src/voice/interview-agent.js";

import {
  investorSession,
  turn,
  type InvestorWorld,
} from "./interviewer-fixtures.js";

/**
 * Lane ob1 scripted conversation evals (deterministic fakes, no provider).
 *
 * The acting model's tool calls are scripted; the onboarding service is the
 * fixture world (the same fake every interview test uses). What is asserted
 * is what code guarantees: what lands on the record, what the coverage tells
 * the next turn to ask, and that a temporary save failure loses nothing and
 * duplicates nothing. Metrics are counted across the suite and printed.
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

/** A model that does what the script says, round by round; keeps what it saw. */
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
  return { gateway, seen, calls: () => index };
}

/** The coverage hint the model was given in its latest state read. */
function lastStateOf(seen: readonly string[]): {
  next: { stepKey: string; reason: string }[];
  steps: { stepKey: string; coverage?: string; savePending?: boolean }[];
} {
  for (const text of [...seen].reverse()) {
    const at = text.lastIndexOf('{"journey"');
    if (at < 0) continue;
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      if (text[i] === "}") depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(at, i + 1)) as ReturnType<
          typeof lastStateOf
        >;
      }
    }
  }
  throw new Error("no state in what the model saw");
}

/** An in-memory onboarding.pending_writes, with the same semantics as the table. */
function memoryPendingWrites(): PendingWriteRepository & {
  readonly rows: () => readonly (PendingWrite & { status: string })[];
} {
  const rows: (PendingWrite & { status: string })[] = [];
  return {
    rows: () => rows,
    hold: (_sql, input) => {
      const same = rows.find((r) => r.idempotencyKey === input.idempotencyKey);
      if (same !== undefined) return Promise.resolve(same);
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

let newKeys = 0;
function heldStore(repository: PendingWriteRepository) {
  return createHeldWritesStore({
    sql: {} as never,
    repository,
    newKey: () =>
      `10000000-0000-4000-8000-${String(++newKeys).padStart(12, "0")}`,
  });
}

/** The world's fetch, failing submissions with 503 while `down()` is true. */
function flaky(
  world: InvestorWorld,
  down: () => boolean,
  options: { readonly commitThenFail?: boolean } = {},
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const isSubmit =
      (init?.method ?? "GET") === "POST" && /\/responses$/.test(url);
    if (isSubmit && down()) {
      if (options.commitThenFail === true) {
        // The write lands, the answer is lost on the way back.
        await world.fetch(input, init);
      }
      return new Response(
        JSON.stringify({ title: "Service Unavailable", status: 503 }),
        {
          status: 503,
          headers: { "content-type": "application/problem+json" },
        },
      );
    }
    return world.fetch(input, init);
  };
}

const metrics = {
  factsStated: 0,
  factsSaved: 0,
  repeatedQuestions: 0,
  writesConfirmed: 0,
  writesPersisted: 0,
  duplicateWrites: 0,
};

afterAll(() => {
  const missed = metrics.factsStated - metrics.factsSaved;
  // One line for the lane report: the eval's own measurements.
  console.info(
    `ob1-eval-metrics ${JSON.stringify({
      ...metrics,
      missedFacts: missed,
      persistenceSuccess:
        metrics.writesConfirmed === 0
          ? null
          : metrics.writesPersisted / metrics.writesConfirmed,
    })}`,
  );
});

const LONG_ANSWER =
  "We're Harbourline Cargo, a seed-stage freight booking platform for West African shippers, based in Nigeria. I'm the CEO, there are two of us founding it, both full-time, and we're nine people today.";

describe("ob1 evals · one long answer fills many non-consecutive fields", () => {
  it("records every stated fact in one call and never asks them again", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.company_name",
      recorded: { "F0.intent": "raising_now" },
    });
    const answers = [
      {
        stepKey: "F1.company_name",
        value: "Harbourline Cargo",
        quote: "We're Harbourline Cargo",
      },
      { stepKey: "F1.stage", value: "seed", quote: "a seed-stage" },
      { stepKey: "F1.country", value: "ng", quote: "based in Nigeria" },
      { stepKey: "F4.founder_role", value: "ceo", quote: "I'm the CEO" },
      {
        stepKey: "F4.founder_count",
        value: 2,
        quote: "there are two of us founding it",
      },
      { stepKey: "F4.full_time", value: "all", quote: "both full-time" },
      { stepKey: "F4.team_size", value: 9, quote: "we're nine people today" },
    ];
    const { gateway, seen } = model([
      { calls: [{ name: "record_answers", arguments: { answers } }] },
      { calls: [{ name: "get_onboarding_state", arguments: {} }] },
      { reply: "Got all of that. What does Harbourline do in a sentence?" },
    ]);
    await createInterviewAgent({ gateway, firewall: firewall(), logger }).turn({
      ...turn(world, LONG_ANSWER),
      actor,
    });

    metrics.factsStated += answers.length;
    for (const a of answers) {
      const saved = world.recordedValue(a.stepKey) !== undefined;
      if (saved) metrics.factsSaved += 1;
      expect(saved, a.stepKey).toBe(true);
    }
    const state = lastStateOf(seen);
    const next = state.next.map((n) => n.stepKey);
    const repeated = answers.filter((a) => next.includes(a.stepKey)).length;
    metrics.repeatedQuestions += repeated;
    expect(repeated).toBe(0);
    for (const a of answers) {
      expect(state.steps.find((s) => s.stepKey === a.stepKey)?.coverage).toBe(
        "CONFIRMED_SAVED",
      );
    }
    // Essentials still open come next (F1.description), not optional nuance.
    expect(state.next[0]?.reason).toBe("ESSENTIAL_MISSING");
  });
});

describe("ob1 evals · a correction to an earlier answer", () => {
  it("changes the one answer without restarting, and coverage shows the new value", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F4.founder_role",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Harbourline Cargo",
        "F1.stage": "seed",
        // Founder v8: the country is a geography node.
        "F1.country": countryOfIso("NG")?.nodeId ?? "",
      },
      taxonomy: { ghana: countryOfIso("GH")?.nodeId ?? "" },
    });
    const { gateway, seen } = model([
      {
        calls: [
          {
            name: "correct_answer",
            arguments: {
              corrections: [
                {
                  stepKey: "F1.country",
                  value: "Ghana",
                  quote: "sorry, we're actually in Ghana",
                },
              ],
            },
          },
        ],
      },
      { calls: [{ name: "get_onboarding_state", arguments: {} }] },
      { reply: "Ghana it is." },
    ]);
    await createInterviewAgent({ gateway, firewall: firewall(), logger }).turn({
      ...turn(world, "Oh, sorry, we're actually in Ghana, not Nigeria."),
      actor,
    });
    expect(world.recordedValue("F1.country")).toEqual(
      founderCountryAnswer("GH"),
    );
    expect(world.recordedValue("F1.stage")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "seed",
    });
    const state = lastStateOf(seen);
    expect(state.next.map((n) => n.stepKey)).not.toContain("F1.country");
  });
});

describe("ob1 evals · reload or interruption keeps confirmed answers", () => {
  it("a fresh interviewer (a reload, a restart) reads the record, not memory, and re-asks nothing", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.company_name",
      recorded: { "F0.intent": "raising_now" },
    });
    const first = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                {
                  stepKey: "F1.company_name",
                  value: "Harbourline Cargo",
                  quote: "We're Harbourline Cargo",
                },
                { stepKey: "F1.stage", value: "seed", quote: "seed-stage" },
              ],
            },
          },
        ],
      },
      { reply: "Thanks." },
    ]);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
    }).turn({
      ...turn(world, "We're Harbourline Cargo, seed-stage."),
      actor,
    });
    // The page reloads: a new interviewer, the same record.
    const second = model([{ reply: "Welcome back." }]);
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
    }).turn({
      ...turn(world, ""),
      actor,
    });
    const state = lastStateOf(second.seen);
    const next = state.next.map((n) => n.stepKey);
    expect(next).not.toContain("F1.company_name");
    expect(next).not.toContain("F1.stage");
    metrics.repeatedQuestions += ["F1.company_name", "F1.stage"].filter((k) =>
      next.includes(k),
    ).length;
  });
});

describe("ob1 evals · a temporary save failure recovers with no loss or duplicates", () => {
  it("holds the confirmed answer, says it is not saved, and saves it exactly once when the service is back", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.stage",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Harbourline Cargo",
      },
    });
    const repository = memoryPendingWrites();
    const store = heldStore(repository);
    let down = true;
    const fetchFlaky = flaky(world, () => down);
    const first = model([
      {
        calls: [
          {
            name: "record_answers",
            arguments: {
              answers: [
                { stepKey: "F1.stage", value: "seed", quote: "we're at seed" },
              ],
            },
          },
        ],
      },
      { reply: "I couldn't save that just yet; I'm holding it." },
    ]);
    const t1 = turn(world, "We're at seed.");
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...t1,
      session: { ...t1.session, fetch: fetchFlaky },
      actor,
    });
    metrics.writesConfirmed += 1;
    // Not on the record, never claimed: the tool told the model so.
    expect(world.recordedValue("F1.stage")).toBeUndefined();
    expect(first.seen.join("\n")).toContain("HELD_FOR_RETRY");
    expect(
      repository
        .rows()
        .filter((r) => r.status === "PENDING")
        .map((r) => r.stepKey),
    ).toEqual(["F1.stage"]);

    // The service is back. The next turn replays before anything else.
    down = false;
    const second = model([{ reply: "Your stage is saved now." }]);
    const t2 = turn(world, "Okay, what next?");
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...t2,
      session: { ...t2.session, fetch: fetchFlaky },
      actor,
    });
    expect(world.recordedValue("F1.stage")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "seed",
    });
    expect(repository.rows().map((r) => r.status)).toEqual(["APPLIED"]);
    expect(second.seen.join("\n")).toContain("is now saved");
    const submissions = world.attempts().filter((k) => k === "F1.stage").length;
    // One attempt refused at the door (503), one replay that landed.
    expect(submissions).toBe(1);
    metrics.writesPersisted += 1;

    // A third turn replays nothing: no duplicates.
    const third = model([{ reply: "Next." }]);
    await createInterviewAgent({
      gateway: third.gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...turn(world, "Go on."),
      actor,
    });
    expect(world.attempts().filter((k) => k === "F1.stage").length).toBe(1);
    metrics.duplicateWrites +=
      world.attempts().filter((k) => k === "F1.stage").length - 1;
  });

  it("a write that landed but whose answer was lost settles without being written again", async () => {
    const world = investorSession({
      journey: "founder",
      currentStepKey: "F1.stage",
      recorded: {
        "F0.intent": "raising_now",
        "F1.company_name": "Harbourline Cargo",
      },
    });
    const repository = memoryPendingWrites();
    const store = heldStore(repository);
    let down = true;
    const fetchFlaky = flaky(world, () => down, { commitThenFail: true });
    const t1 = turn(world, "We're at seed.");
    await createInterviewAgent({
      gateway: model([
        {
          calls: [
            {
              name: "record_answers",
              arguments: {
                answers: [
                  {
                    stepKey: "F1.stage",
                    value: "seed",
                    quote: "we're at seed",
                  },
                ],
              },
            },
          ],
        },
        { reply: "Holding it." },
      ]).gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({ ...t1, session: { ...t1.session, fetch: fetchFlaky }, actor });
    metrics.writesConfirmed += 1;
    down = false;
    const t2 = turn(world, "And now?");
    await createInterviewAgent({
      gateway: model([{ reply: "Saved." }]).gateway,
      firewall: firewall(),
      logger,
      heldWrites: store,
    }).turn({
      ...t2,
      session: { ...t2.session, fetch: fetchFlaky },
      actor,
    });
    expect(world.recordedValue("F1.stage")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "seed",
    });
    expect(repository.rows().map((r) => r.status)).toEqual(["APPLIED"]);
    // Only the original (lost-answer) submission ever reached the record.
    const submissions = world.attempts().filter((k) => k === "F1.stage").length;
    expect(submissions).toBe(1);
    metrics.writesPersisted += 1;
    metrics.duplicateWrites += submissions - 1;
  });
});
