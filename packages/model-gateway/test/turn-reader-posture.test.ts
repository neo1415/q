import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader } from "../src/q/index.js";
import {
  TURN_READER_ATTEMPT_TIMEOUT_MS,
  TURN_READER_SAME_MODEL_HEDGE_MS,
} from "../src/q/turn-reader.js";

/**
 * The turn reader declares the deployment's data posture like every other
 * Q caller (doc 15 §62), so the FAST_CLASSIFICATION policy's preferred
 * model can serve it where the material is attested synthetic; without a
 * posture nothing is declared and the sensitivity ceiling decides.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

function recording() {
  const requests: Record<string, unknown>[] = [];
  const options: Record<string, unknown>[] = [];
  const gateway = {
    execute: (
      request: Record<string, unknown>,
      option: Record<string, unknown>,
    ) => {
      requests.push(request);
      options.push(option);
      return Promise.resolve({
        output: {
          kind: "STRUCTURED",
          value: {
            kind: "SMALL_TALK",
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
  return { gateway, requests, options };
}

const input = {
  utterance: "Hi Q, are you there?",
  recentTurns: [],
  modality: "TEXT" as const,
  attribution: {
    tenantId: "c0000000-0000-4000-8000-000000000001",
    userId: "b0000000-0000-4000-8000-000000000001",
    correlationId: "cor_test",
  },
};

describe("the turn reader's data posture", () => {
  it("travels with the request when the composition declares one", async () => {
    const { gateway, requests } = recording();
    await createQTurnReader({
      gateway,
      logger,
      dataPosture: "SYNTHETIC_DEMO",
    }).read(input);
    expect(requests[0]?.dataPosture).toBe("SYNTHETIC_DEMO");
    expect(requests[0]?.taskClass).toBe("FAST_CLASSIFICATION");
    expect(requests[0]?.sensitivity).toBe("CONFIDENTIAL");
  });

  it("is not declared when the composition has none", async () => {
    const { gateway, requests } = recording();
    await createQTurnReader({ gateway, logger }).read(input);
    expect(requests[0]).not.toHaveProperty("dataPosture");
  });

  // Live 2026-11-16 (runs d58a4564, 11daded9, 7cef5d87, 06de74f3): luna was
  // cut at 2.5 s under the synthetic posture and the policy's 2.0 s hedge
  // went to claude-sonnet-5-5, up to USD 0.058 a read. Every posture now
  // cuts at 4 s (past 99.86% of luna's reads), hedging on luna first.
  it("cuts each luna attempt at 4 s in every posture, and hedges on the same model before the backup", async () => {
    for (const dataPosture of ["SYNTHETIC_DEMO", "REAL_CUSTOMER"] as const) {
      const seen = recording();
      await createQTurnReader({
        gateway: seen.gateway,
        logger,
        dataPosture,
      }).read(input);
      expect(seen.options[0]?.firstAttemptTimeoutMs).toBe(4_000);
      expect(seen.options[0]?.sameModelHedgeFirst).toBe(true);
      expect(seen.options[0]?.sameModelHedgeAfterMs).toBe(2_500);
      const budget = seen.requests[0]?.budget as {
        attemptTimeoutMs: number;
        maxAttempts: number;
      };
      expect(budget.attemptTimeoutMs).toBe(TURN_READER_ATTEMPT_TIMEOUT_MS);
      // The model, its hedge, then the backup when both failed.
      expect(budget.maxAttempts).toBe(3);
    }
  });

  // Live 2026-10-29: a real customer's read has one eligible model, so a
  // stalled read hedges to the same model instead of leaving the turn unread.
  it("a real customer's read hedges to the same model when it stalls", async () => {
    const { gateway, options } = recording();
    await createQTurnReader({ gateway, logger }).read(input);
    expect(options[0]?.sameModelHedgeAfterMs).toBe(
      TURN_READER_SAME_MODEL_HEDGE_MS,
    );
    expect(TURN_READER_SAME_MODEL_HEDGE_MS).toBeLessThan(
      TURN_READER_ATTEMPT_TIMEOUT_MS,
    );
  });

  // Live 2026-10-30 (run 8bc5116c): reads of ~17k tokens answered at p90
  // 5.7 s that day, so a 6 s cut-off left a planning ask unread.
  it("gives each reading attempt room past the reader's measured p90", () => {
    expect(TURN_READER_ATTEMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(9_000);
  });
});
