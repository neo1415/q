import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import type { ModelGateway } from "../src/index.js";
import { createQTurnReader } from "../src/q/index.js";

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
  const gateway = {
    execute: (request: Record<string, unknown>) => {
      requests.push(request);
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
  return { gateway, requests };
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
});
