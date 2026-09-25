import { describe, expect, it } from "vitest";

import { createLogger } from "@capital-q/observability";

import { ModelGatewayError, type ModelGateway } from "../src/index.js";
import { createQDelegationReader } from "../src/q/index.js";

/**
 * Which choices the person handed to Q, read independently of the
 * acting model. Properties: only steps offered can come back, anything
 * unreadable is null (nothing handed over), and nothing said reads as
 * nothing handed over without a model call.
 */

const logger = createLogger(
  { serviceName: "model-gateway-test", environment: "test" },
  { level: "silent" },
);

const STEPS = [
  {
    stepKey: "I7.hard_exclusions",
    question: "What should never be shown?",
    about: "A hard exclusion: not shown.",
    required: false,
  },
  {
    stepKey: "I7.avoid",
    question: "What would you rather not see?",
    about: "A soft negative: ranked lower.",
    required: false,
  },
  {
    stepKey: "I2.stages",
    question: "Which stages do you invest at?",
    about: "",
    required: true,
  },
];
const PENDING = [{ stepKey: "I7.avoid", recommended: "Gambling" }];
const ATTRIBUTION = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  correlationId: "cor_test",
};

function gatewayReturning(value: unknown, calls: { n: number }): ModelGateway {
  return {
    execute: () => {
      calls.n += 1;
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve({ output: { kind: "STRUCTURED", value } });
    },
  } as unknown as ModelGateway;
}

describe("the delegation reading", () => {
  it("returns only steps it was offered, and approvals only of what is pending", async () => {
    const calls = { n: 0 };
    const reader = createQDelegationReader({
      gateway: gatewayReturning(
        {
          delegated: [
            { stepKey: "I7.hard_exclusions" },
            { stepKey: "I9.discovery_mode" },
          ],
          approved: [
            { stepKey: "I7.avoid" },
            { stepKey: "I7.hard_exclusions" },
          ],
        },
        calls,
      ),
      logger,
    });
    const authority = await reader.read({
      utterance: "Pick three exclusions for me and go with those.",
      lastQ: "",
      steps: STEPS,
      pending: PENDING,
      attribution: ATTRIBUTION,
    });
    expect(authority === null ? null : [...authority.handed]).toEqual([
      "I7.hard_exclusions",
    ]);
    expect(authority === null ? null : [...authority.approved]).toEqual([
      "I7.avoid",
    ]);
    expect(calls.n).toBe(1);
  });

  it("stated is limited to offered steps, and a required step is never declined", async () => {
    const reader = createQDelegationReader({
      gateway: gatewayReturning(
        {
          stated: [{ stepKey: "I2.stages" }, { stepKey: "I3.geography" }],
          declined: [{ stepKey: "I7.avoid" }, { stepKey: "I2.stages" }],
          finishing: true,
        },
        { n: 0 },
      ),
      logger,
    });
    const authority = await reader.read({
      utterance: "Seed only, and nothing I'd rather not see. That's all.",
      lastQ: "",
      steps: STEPS,
      pending: [],
      attribution: ATTRIBUTION,
    });
    expect(authority === null ? null : [...authority.stated]).toEqual([
      "I2.stages",
    ]);
    expect(authority === null ? null : [...authority.declined]).toEqual([
      "I7.avoid",
    ]);
    expect(authority?.finishing).toBe(true);
  });

  it("an unreadable turn is null, which hands nothing over", async () => {
    for (const value of [
      new ModelGatewayError("no route", {
        failureClass: "PROVIDER_OUTAGE",
        attempts: 2,
        candidates: [],
      }),
      { delegated: "everything" },
    ]) {
      const reader = createQDelegationReader({
        gateway: gatewayReturning(value, { n: 0 }),
        logger,
      });
      expect(
        await reader.read({
          utterance: "Go with whatever you think.",
          lastQ: "",
          steps: STEPS,
          pending: PENDING,
          attribution: ATTRIBUTION,
        }),
      ).toBeNull();
    }
  });

  it("nothing said hands nothing over, without asking a model", async () => {
    const calls = { n: 0 };
    const reader = createQDelegationReader({
      gateway: gatewayReturning({ delegated: [] }, calls),
      logger,
    });
    const authority = await reader.read({
      utterance: "   ",
      lastQ: "",
      steps: STEPS,
      pending: PENDING,
      attribution: ATTRIBUTION,
    });
    expect(authority?.handed.size).toBe(0);
    expect(authority?.approved.size).toBe(0);
    expect(calls.n).toBe(0);
  });
});
