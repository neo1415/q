import { describe, expect, it } from "vitest";

import type { ModelGatewayRequest } from "@capital-q/contracts";
import { createLogger } from "@capital-q/observability";

import { ModelGatewayError, type ModelGateway } from "../src/index.js";
import { toInput } from "../src/providers/openai.js";
import { createQTurnReader } from "../src/q/index.js";

/**
 * Model spend, 18 Nov 2026 (ai_ops.model_usage): the turn reader's ~14k
 * tokens of fixed rules opened its user message, and the provider's cache
 * never reached past the instructions and schema (~4.6k of ~22.7k tokens a
 * reading). TURN_READER v92 sends the rules as instructions. These fakes
 * count the calls a reading makes and check what each one carries; no
 * provider is called and nothing is timed.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

const READING = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
};

function recording(
  answer: (request: ModelGatewayRequest, signal?: AbortSignal) => unknown,
) {
  const requests: ModelGatewayRequest[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const gateway = {
    execute: (
      request: ModelGatewayRequest,
      options: { readonly signal?: AbortSignal | undefined },
    ): Promise<unknown> => {
      requests.push(request);
      signals.push(options.signal);
      try {
        return Promise.resolve(answer(request, options.signal));
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error("x"));
      }
    },
  } as unknown as ModelGateway;
  return { gateway, requests, signals };
}

function input(utterance: string, signal?: AbortSignal) {
  return {
    utterance,
    recentTurns: [{ role: "Q" as const, text: "Here are three fintechs." }],
    modality: "TEXT" as const,
    shown: "Q showed: Zorvanta, Quellbrook, Ajopot",
    attribution: {
      tenantId: "c0000000-0000-4000-8000-000000000001",
      userId: "b0000000-0000-4000-8000-000000000001",
      correlationId: "cor_cache_layout",
      qRunId: "d0000000-0000-4000-8000-000000000001",
    },
    ...(signal === undefined ? {} : { signal }),
  };
}

const ok = () => ({ output: { kind: "STRUCTURED", value: READING } });

describe("the turn reader's prompt layout (v92)", () => {
  it("makes one call a reading: the charter's fixed head and the rules shared, then the charter's tail, then the turn (v97)", async () => {
    const seen = recording(ok);
    const reader = createQTurnReader({ gateway: seen.gateway, logger });
    const read = await reader.read(input("Which of these have revenue?"));
    expect(read?.kind).toBe("QUESTION_TO_Q");
    expect(seen.requests).toHaveLength(1);
    const messages = seen.requests[0]?.messages ?? [];
    expect(messages.map((m) => m.role)).toEqual([
      "SYSTEM",
      "SYSTEM",
      "SYSTEM",
      "USER",
    ]);
    // HQ-8 (v97): the fixed text leads, marked shared, before anything
    // of the person.
    const shared = (m: (typeof messages)[number] | undefined) =>
      m !== undefined &&
      m.role === "SYSTEM" &&
      "shared" in m &&
      m.shared === true;
    expect(messages.slice(0, 2).map(shared)).toEqual([true, true]);
    expect(shared(messages[2])).toBe(false);
    expect(messages[1]?.content.startsWith("TASK: TURN_READER")).toBe(true);
    expect(messages[1]?.content).not.toContain("Which of these have revenue?");
    expect(messages[1]?.content).not.toContain("Zorvanta");
    expect(messages[3]?.content).toContain("Which of these have revenue?");
    expect(messages[3]?.content).toContain("Zorvanta");
  });

  it("sends identical instructions for two different turns, so the cached prefix holds", async () => {
    const seen = recording(ok);
    const reader = createQTurnReader({ gateway: seen.gateway, logger });
    await reader.read(input("Which of these have revenue?"));
    await reader.read(input("And the weakest first?"));
    expect(seen.requests).toHaveLength(2);
    const [one, two] = seen.requests.map((request) =>
      toInput(request.messages),
    );
    expect(one?.instructions).toBeDefined();
    expect(two?.instructions).toBe(one?.instructions);
    // The rules are in the shared instructions; the charter's per-person
    // tail follows as a developer message, then the turn (v97).
    expect(one?.instructions).toContain("TASK: TURN_READER");
    expect(one?.input).toHaveLength(2);
    expect(JSON.stringify(two?.input)).toContain("And the weakest first?");
    expect(JSON.stringify(two?.input)).not.toContain("TASK: TURN_READER");
  });

  it("re-asks a refused reading once, the correction after the turn, the instructions unchanged", async () => {
    let calls = 0;
    const seen = recording(() => {
      calls += 1;
      if (calls === 1) {
        throw new ModelGatewayError("refused", {
          failureClass: "INVALID_MODEL_OUTPUT",
          attempts: 1,
          candidates: [],
        });
      }
      return ok();
    });
    const reader = createQTurnReader({ gateway: seen.gateway, logger });
    await reader.read(input("Which of these have revenue?"));
    expect(seen.requests).toHaveLength(2);
    expect(seen.requests[1]?.messages.at(-1)?.role).toBe("USER");
    for (const request of seen.requests) {
      expect(request.messages.slice(0, 2).map((m) => m.role)).toEqual([
        "SYSTEM",
        "SYSTEM",
      ]);
      expect(request.messages[1]?.content).toBe(
        seen.requests[0]?.messages[1]?.content,
      );
    }
  });

  it("passes the turn's cancellation to the gateway, and a cancelled reading is never re-asked", async () => {
    const abort = new AbortController();
    const seen = recording(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                new ModelGatewayError("model request cancelled", {
                  failureClass: "CANCELLED",
                  attempts: 1,
                  candidates: [],
                }),
              ),
            { once: true },
          );
        }),
    );
    const failures: unknown[] = [];
    const reader = createQTurnReader({ gateway: seen.gateway, logger });
    const reading = reader.read({
      ...input("Which of these have revenue?", abort.signal),
      onFailure: (failure) => failures.push(failure),
    });
    abort.abort();
    expect(await reading).toBeNull();
    expect(seen.requests).toHaveLength(1);
    expect(seen.signals[0]).toBe(abort.signal);
    expect(seen.signals[0]?.aborted).toBe(true);
    // A cancellation is not a failure to tell the person about.
    expect(failures).toEqual([]);
  });
});
