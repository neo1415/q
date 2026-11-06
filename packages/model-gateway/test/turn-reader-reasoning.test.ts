import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { reasoningUnderPolicy } from "../src/policy/eligibility.js";
import {
  createQTurnReader,
  TURN_READER_REASONING,
  TURN_READER_REASONING_KEY,
} from "../src/q/index.js";

/**
 * Reader thinking off (owner 2026-11-06, after live Q-IQ run 2 measured
 * the reader at 4-5 s before every answer). Same task class, same model
 * routing, same schema: only the reasoning level changes, and it is keyed
 * so the routing data can raise it again without a deploy.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

function recording() {
  const requests: Record<string, unknown>[] = [];
  const gateway = {
    execute: (request: Record<string, unknown>) => {
      requests.push(request);
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            kind: "QUESTION_TO_Q",
            confidence: "HIGH",
            transcript: "CLEAR",
            question: null,
            aboutNamedOther: false,
            tool: null,
          },
        },
      });
    },
  } as unknown as ModelGateway;
  return { gateway, requests };
}

const input = {
  utterance: "And its burn?",
  recentTurns: [],
  modality: "TEXT" as const,
  attribution: {
    tenantId: "c0000000-0000-4000-8000-000000000001",
    userId: "b0000000-0000-4000-8000-000000000001",
    correlationId: "cor_test",
  },
};

describe("the turn reader's reasoning", () => {
  it("asks for no thinking, keyed TURN_READ, on the same task class", async () => {
    const { gateway, requests } = recording();
    await createQTurnReader({ gateway, logger }).read(input);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.taskClass).toBe("FAST_CLASSIFICATION");
    expect(requests[0]?.reasoning).toBe("NONE");
    expect(requests[0]?.reasoningKey).toBe("TURN_READ");
    expect(TURN_READER_REASONING).toBe("NONE");
    expect(TURN_READER_REASONING_KEY).toBe("TURN_READ");
  });

  it("stays NONE under today's policies, and routing data can raise it without a deploy", () => {
    const request = {
      reasoning: TURN_READER_REASONING,
      reasoningKey: TURN_READER_REASONING_KEY,
    };
    // No map (every FAST_CLASSIFICATION policy today), or a map without
    // the key: the request's own level.
    expect(reasoningUnderPolicy({ reasoningLevels: null }, request)).toBe(
      "NONE",
    );
    expect(
      reasoningUnderPolicy(
        { reasoningLevels: { ANSWER_LOOKUP: "LOW" } },
        request,
      ),
    ).toBe("NONE");
    // The rollback lever: one data update on the policy.
    expect(
      reasoningUnderPolicy({ reasoningLevels: { TURN_READ: "LOW" } }, request),
    ).toBe("LOW");
  });
});
