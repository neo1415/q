import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import { ModelGatewayError, type ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createInterviewAgent,
  thisTurnText,
} from "../src/voice/interview-agent.js";

import { investorSession, turn } from "./interviewer-fixtures.js";

/**
 * Reliability (ACC 2026-09-25): a luna attempt ran 5.5 minutes, and a
 * Gemini fallback could not continue a tool-calling history it did not
 * sign; both reached the person as HTTP 503. Properties: every round is
 * provider-neutral (no native tool history ever travels), every call is
 * bounded by the turn's deadline, and a model failing mid-turn degrades
 * to an honest reply that keeps what was already recorded.
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

type Seen = {
  readonly roles: readonly string[];
  readonly toolHistory: boolean;
  readonly text: string;
  readonly firstAttemptTimeoutMs: number | undefined;
  readonly attemptTimeoutMs: number | undefined;
  readonly signal: AbortSignal | undefined;
};

type Request = {
  readonly messages: readonly {
    readonly role: string;
    readonly content: string;
    readonly toolCalls?: readonly unknown[];
  }[];
  readonly budget?: { readonly attemptTimeoutMs?: number };
};
type Options = {
  readonly firstAttemptTimeoutMs?: number;
  readonly signal?: AbortSignal;
};

function see(request: Request, options: Options | undefined): Seen {
  return {
    roles: request.messages.map((m) => m.role),
    toolHistory: request.messages.some(
      (m) => m.role === "TOOL" || (m.toolCalls?.length ?? 0) > 0,
    ),
    text: request.messages.map((m) => m.content).join("\n"),
    firstAttemptTimeoutMs: options?.firstAttemptTimeoutMs,
    attemptTimeoutMs: request.budget?.attemptTimeoutMs,
    signal: options?.signal,
  };
}

const RECORD_STAGES = {
  name: "record_answers",
  arguments: {
    answers: [{ stepKey: "I2.stages", value: "Pre-seed", quote: "Pre-seed" }],
  },
};
const RECORD_CURRENCY = {
  name: "record_answers",
  arguments: {
    answers: [
      { stepKey: "I2.currency", value: "US dollar", quote: "in dollars" },
    ],
  },
};

function toolCalls(round: number, call: { name: string; arguments: unknown }) {
  return Promise.resolve({
    output: {
      kind: "TOOL_CALLS",
      text: "",
      calls: [{ callId: `call_${String(round)}`, ...call }],
    },
  });
}

function reply(text: string) {
  return Promise.resolve({
    output: {
      kind: "TEXT",
      text: JSON.stringify({ reply: text, asking: null }),
    },
  });
}

describe("reliability · every round is provider-neutral", () => {
  it("never sends native tool history, and each round carries what was done", async () => {
    // Property over how many tool rounds precede the reply.
    for (let toolRounds = 0; toolRounds <= 3; toolRounds += 1) {
      const world = investorSession({ currentStepKey: "I2.stages" });
      const seen: Seen[] = [];
      let round = 0;
      const gateway = {
        execute: (request: Request, options?: Options) => {
          seen.push(see(request, options));
          round += 1;
          if (round <= toolRounds) {
            return toolCalls(
              round,
              round % 2 === 1 ? RECORD_STAGES : RECORD_CURRENCY,
            );
          }
          return reply("Pre-seed, in dollars. What cheque size?");
        },
      } as unknown as ModelGateway;
      const agent = createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
      });

      const outcome = await agent.turn({
        ...turn(world, "Pre-seed, in dollars."),
        actor,
      });

      expect(outcome.degraded).toBe(false);
      expect(seen).toHaveLength(toolRounds + 1);
      for (const [index, request] of seen.entries()) {
        expect(request.toolHistory, `round ${String(index)}`).toBe(false);
        expect(request.roles.every((r) => r === "SYSTEM" || r === "USER")).toBe(
          true,
        );
        // Round n sees the results of every earlier round, as data.
        const earlier = Math.min(index, toolRounds);
        expect(request.text.split('"tool":"record_answers"').length - 1).toBe(
          earlier,
        );
      }
    }
  });

  it("a model failing after the tools ran keeps the writes and replies honestly, never throws", async () => {
    const world = investorSession({ currentStepKey: "I2.stages" });
    let round = 0;
    const gateway = {
      execute: () => {
        round += 1;
        if (round === 1) return toolCalls(round, RECORD_STAGES);
        // What the Gemini fallback returned on a replayed OpenAI history.
        return Promise.reject(
          new ModelGatewayError("provider rejected the request", {
            failureClass: "INVALID_REQUEST",
            attempts: 2,
            candidates: [],
          }),
        );
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    const outcome = await agent.turn({ ...turn(world, "Pre-seed."), actor });

    expect(outcome.recorded).toContain("I2.stages");
    expect(outcome.degraded).toBe(true);
    expect(outcome.reply.length).toBeGreaterThan(0);
  });
});

describe("reliability · the turn is bounded by its deadline", () => {
  it("caps the first attempt and every attempt, and passes the deadline to each call", async () => {
    const world = investorSession({ currentStepKey: "I2.stages" });
    const seen: Seen[] = [];
    const gateway = {
      execute: (request: Request, options?: Options) => {
        seen.push(see(request, options));
        return reply("Noted.");
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    await agent.turn({ ...turn(world, "Pre-seed."), actor });

    const first = seen[0];
    expect(first?.firstAttemptTimeoutMs).toBeLessThanOrEqual(8_000);
    expect(first?.attemptTimeoutMs).toBeLessThanOrEqual(12_000);
    expect(first?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a model that never answers ends in a degraded reply by the deadline, not a hang", async () => {
    const world = investorSession({ currentStepKey: "I2.stages" });
    const gateway = {
      execute: (_request: Request, options?: Options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(
              new ModelGatewayError("model request cancelled", {
                failureClass: "CANCELLED",
                attempts: 1,
                candidates: [],
              }),
            );
          });
        }),
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      turnDeadlineMs: 300,
    });

    const started = Date.now();
    const outcome = await agent.turn({ ...turn(world, "Pre-seed."), actor });

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(outcome.degraded).toBe(true);
    expect(outcome.reply.length).toBeGreaterThan(0);
  });

  it("the person leaving is still a cancellation", async () => {
    const world = investorSession({ currentStepKey: "I2.stages" });
    const gone = new AbortController();
    const gateway = {
      execute: () => {
        gone.abort();
        return Promise.reject(
          new ModelGatewayError("model request cancelled", {
            failureClass: "CANCELLED",
            attempts: 1,
            candidates: [],
          }),
        );
      },
    } as unknown as ModelGateway;
    const agent = createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
    });

    await expect(
      agent.turn({
        ...turn(world, "Pre-seed."),
        actor,
        signal: gone.signal,
      }),
    ).rejects.toThrow();
  });
});

describe("reliability · this turn's actions as data", () => {
  it("drops the oldest actions first and always fits", () => {
    const actions = Array.from({ length: 40 }, (_, i) => ({
      tool: "record_answers",
      input: { i, pad: "x".repeat(900) },
      result: { outcome: "COMMITTED", i },
    }));
    const text = thisTurnText(actions);
    expect(text.length).toBeLessThanOrEqual(12_000);
    const kept = JSON.parse(text) as { input: { i: number } }[];
    expect(kept.at(-1)?.input.i).toBe(39);
    expect(thisTurnText([])).toBe("");
  });
});
