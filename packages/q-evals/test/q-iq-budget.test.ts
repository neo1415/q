import { describe, expect, it } from "vitest";

import { createAnthropicModelProvider } from "@capital-q/model-gateway/providers/anthropic";

import { Q_IQ_DATASET } from "../src/datasets/q-iq/index.js";
import {
  bareModelQIqSubject,
  runQIq,
  type QIqSubject,
} from "../src/runner/q-iq.js";

/**
 * The Q-IQ budget is hard (DECISIONS 62: a $20 cap on Claude testing): a
 * case starts only if the dearest case so far would still fit. No model,
 * no network: the subject reports a fixed cost per turn.
 */

const cases = Q_IQ_DATASET.cases.slice(0, 20);

function fixedCostSubject(perTurnUsd: number): QIqSubject {
  return {
    name: "fixed",
    open: () =>
      Promise.resolve({
        say: () =>
          Promise.resolve({
            text: "(fixed)",
            latencyMs: 1,
            costUsd: perTurnUsd,
            inputTokens: 1,
            outputTokens: 1,
          }),
      }),
  };
}

describe("Q-IQ hard budget", () => {
  it("stops before a case that could take it past the budget", async () => {
    const result = await runQIq(fixedCostSubject(0.1), cases, { budgetUsd: 1 });
    expect(result.stoppedForBudget).toBe(true);
    expect(result.costUsd).toBeLessThanOrEqual(1);
    expect(result.casesRun).toBeLessThan(cases.length);
  });

  it("runs every case when the budget allows it", async () => {
    const result = await runQIq(fixedCostSubject(0.001), cases, {
      budgetUsd: 10,
    });
    expect(result.stoppedForBudget).toBe(false);
    expect(result.casesRun).toBe(cases.length);
  });

  it("prices a bare Claude subject from the adapter's usage, at the budget rate", async () => {
    const client = {
      messages: {
        create: () =>
          Promise.resolve({
            id: "msg_synthetic",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: [{ type: "text", text: "An answer.", citations: null }],
            stop_reason: "end_turn",
            stop_sequence: null,
            stop_details: null,
            usage: {
              input_tokens: 1_000_000,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              output_tokens: 0,
            },
          }),
        stream: () => {
          throw new Error("unused");
        },
      },
    } as unknown as NonNullable<
      Parameters<typeof createAnthropicModelProvider>[0]["client"]
    >;
    const subject = bareModelQIqSubject({
      provider: createAnthropicModelProvider({ apiKey: "unused", client }),
      modelCode: "claude-sonnet-5-5",
      price: {
        inputPerMillion: 2.5,
        cachedInputPerMillion: 0.2,
        outputPerMillion: 10,
      },
    });
    const first = cases[0];
    if (first === undefined) throw new Error("no case");
    const conversation = await subject.open(first);
    const reply = await conversation.say("Hello");
    expect(reply.text).toBe("An answer.");
    expect(reply.costUsd).toBeCloseTo(2.5, 6);
  });
});
