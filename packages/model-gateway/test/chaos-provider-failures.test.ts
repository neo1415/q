import { describe, expect, it } from "vitest";

import type { ModelProviderCode } from "@capital-q/contracts";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  isModelServiceUnavailable,
  ModelGatewayError,
  type FakeBehaviour,
  type ModelProvider,
} from "../src/index.js";
import { IDS, request, testCatalog } from "./fixtures.js";

/**
 * Premium Plan P1 chaos test. The confidential-grade provider ("alpha", as
 * OpenAI in production) fails with each failure class in turn while a
 * PUBLIC-only provider ("beta", as Gemini) stays healthy. Over many turns:
 *
 *   - every turn is either answered or fails with a class Q turns into an
 *     honest reply (unreachable, or "send it again"), never a raw error;
 *   - no CONFIDENTIAL request ever reaches the PUBLIC-only provider;
 *   - PUBLIC work keeps being answered by the healthy provider;
 *   - after alpha heals, turns are answered again within the probe or
 *     back-off interval, by the same gateway: no restart.
 *
 * A second scenario adds a CONFIDENTIAL-eligible backup ("gamma"): then
 * every confidential turn is answered through every failure class, which
 * is the routing change the 5 Nov incident needs.
 */

const START = Date.parse("2026-11-06T10:00:00.000Z");
const TURN_EVERY_MS = 5_000;
const TURNS = 24; // two minutes of turns, past every block and back-off

type FailureCase = {
  readonly name: string;
  readonly behaviour: FakeBehaviour;
};

const FAILURES: readonly FailureCase[] = [
  {
    name: "credit or quota spent",
    behaviour: {
      kind: "FAIL",
      failureClass: "PERMANENT",
      accountExhausted: true,
    },
  },
  {
    name: "key refused",
    behaviour: { kind: "FAIL", failureClass: "AUTHENTICATION" },
  },
  {
    name: "rate limited",
    behaviour: {
      kind: "FAIL",
      failureClass: "RATE_LIMIT",
      retryAfterMs: 20_000,
    },
  },
  { name: "timed out", behaviour: { kind: "FAIL", failureClass: "TIMEOUT" } },
  {
    name: "provider 5xx",
    behaviour: { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
  },
];

/** A provider whose behaviour can be switched mid-run, as an outage heals. */
function switchable(code: ModelProviderCode, behaviour: FakeBehaviour) {
  let current = createFakeModelProvider({ code, script: [behaviour] });
  const sensitivities: string[] = [];
  const provider: ModelProvider = {
    code,
    capabilities: () => current.capabilities(),
    generate: (providerRequest, context) => {
      sensitivities.push(currentSensitivity.value);
      return current.generate(providerRequest, context);
    },
  };
  return {
    provider,
    sensitivities,
    set: (next: FakeBehaviour) => {
      current = createFakeModelProvider({ code, script: [next] });
    },
  };
}

/** The sensitivity of the request being executed (requests run one by one). */
const currentSensitivity = { value: "PUBLIC" };

const SERVED: FakeBehaviour = { kind: "TEXT", text: "an answer" };

/** What Q says when a turn's model call fails (answer.ts TURN_* replies). */
function qReplyFor(error: unknown): "UNREACHABLE" | "SEND_AGAIN" | "RAW" {
  if (!(error instanceof ModelGatewayError)) return "RAW";
  return isModelServiceUnavailable(error) ? "UNREACHABLE" : "SEND_AGAIN";
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture missing");
  return value;
}

function world(withConfidentialBackup: boolean, failure: FakeBehaviour) {
  const ms = { value: START };
  const alpha = switchable("alpha", failure);
  const beta = switchable("beta", SERVED);
  const gamma = switchable("gamma", SERVED);
  const catalog = testCatalog((snapshot) =>
    withConfidentialBackup
      ? {
          ...snapshot,
          providers: [
            ...snapshot.providers,
            {
              id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
              code: "gamma",
              name: "Gamma (reviewed backup)",
              status: "ACTIVE",
              privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
              supportsZeroRetention: true,
              regionSupport: ["global"],
            },
          ],
          models: [
            ...snapshot.models,
            {
              ...must(snapshot.models.find((m) => m.id === IDS.alphaStandard)),
              id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
              providerId: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
              modelCode: "gamma-standard",
            },
          ],
          prices: [
            ...snapshot.prices,
            {
              ...must(
                snapshot.prices.find((p) => p.modelId === IDS.alphaStandard),
              ),
              id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
              modelId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
            },
          ],
          routingPolicies: snapshot.routingPolicies.map((policy) =>
            policy.code === "normal_dialogue.v1"
              ? {
                  ...policy,
                  fallbackModels: [
                    "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
                    ...policy.fallbackModels,
                  ],
                }
              : policy,
          ),
        }
      : snapshot,
  );
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog),
    registry: createModelProviderRegistry([
      alpha.provider,
      beta.provider,
      gamma.provider,
    ]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    clock: { now: () => new Date(ms.value) },
    health: createProcessLocalProviderHealth(),
    probeWaitMs: 200,
  });
  const turn = async (sensitivity: "PUBLIC" | "CONFIDENTIAL") => {
    currentSensitivity.value = sensitivity;
    try {
      const result = await gateway.execute(request({ sensitivity }));
      return { served: true as const, provider: result.providerCode };
    } catch (error: unknown) {
      return { served: false as const, reply: qReplyFor(error) };
    }
  };
  return { ms, alpha, beta, gamma, turn };
}

describe("chaos: the confidential provider fails with every failure class", () => {
  for (const failure of FAILURES) {
    it(`${failure.name}: honest degradation, no confidential leak, recovery without a restart`, async () => {
      const { ms, alpha, beta, turn } = world(false, failure.behaviour);
      const outcomes: Awaited<ReturnType<typeof turn>>[] = [];
      for (let i = 0; i < TURNS; i += 1) {
        ms.value = START + i * TURN_EVERY_MS;
        outcomes.push(await turn("CONFIDENTIAL"));
        // PUBLIC work alongside: answered by the healthy PUBLIC provider.
        const publicTurn = await turn("PUBLIC");
        expect(publicTurn.served).toBe(true);
      }
      // 100% of turns answered or honestly degraded; never a raw error.
      for (const outcome of outcomes) {
        if (!outcome.served) expect(outcome.reply).not.toBe("RAW");
      }
      // 0 confidential payloads to the PUBLIC-only provider.
      expect(beta.sensitivities).not.toContain("CONFIDENTIAL");

      // Alpha heals. The same gateway serves confidential turns again
      // within the longest interval (probe 30 s, rate back-off 20 s,
      // outage breaker 30 s).
      alpha.set(SERVED);
      const healedAt = START + TURNS * TURN_EVERY_MS;
      let recoveredAfterMs: number | null = null;
      for (let after = 0; after <= 35_000; after += TURN_EVERY_MS) {
        ms.value = healedAt + after;
        const outcome = await turn("CONFIDENTIAL");
        if (outcome.served && outcome.provider === "alpha") {
          recoveredAfterMs = after;
          break;
        }
        expect(outcome.served ? "SERVED" : outcome.reply).not.toBe("RAW");
      }
      expect(recoveredAfterMs).not.toBeNull();
      expect(recoveredAfterMs ?? Infinity).toBeLessThanOrEqual(30_000);
      expect(beta.sensitivities).not.toContain("CONFIDENTIAL");
    });
  }
});

describe("chaos, with a CONFIDENTIAL-eligible backup (the recommended routing)", () => {
  for (const failure of FAILURES) {
    it(`${failure.name}: every confidential turn is answered`, async () => {
      const { ms, beta, gamma, turn } = world(true, failure.behaviour);
      for (let i = 0; i < TURNS; i += 1) {
        ms.value = START + i * TURN_EVERY_MS;
        const outcome = await turn("CONFIDENTIAL");
        expect(outcome.served).toBe(true);
      }
      expect(gamma.sensitivities.length).toBeGreaterThan(0);
      expect(beta.sensitivities).not.toContain("CONFIDENTIAL");
    });
  }
});
