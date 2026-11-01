import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  isModelServiceUnavailable,
  ModelGatewayError,
  ModelProviderFailure,
  type FakeBehaviour,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Live 2026-10-31 (q-api 24af1559a): OpenAI credit ran out, the account
 * block opened for ten minutes, the owner topped up, and every turn until
 * the block lapsed still had no route. While a block is open, one real
 * request now probes it every half-minute; a success clears it.
 */

const START = Date.parse("2026-10-31T15:18:31.000Z");

function clockAt(ms: { value: number }) {
  return { now: () => new Date(ms.value) };
}

function build(script: readonly FakeBehaviour[], ms: { value: number }) {
  const alpha = createFakeModelProvider({ code: "alpha", script });
  const logLines: { readonly level: string; readonly message: string }[] = [];
  const line =
    (level: string) =>
    (_: unknown, message: string): void => {
      logLines.push({ level, message });
    };
  const logger = {
    debug: line("debug"),
    info: line("info"),
    warn: line("warn"),
    error: line("error"),
    child: () => logger,
  };
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    // Only alpha is configured: no fallback, as in the incident.
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    logger,
    clock: clockAt(ms),
    health: createProcessLocalProviderHealth({
      blockedProbeIntervalMs: 30_000,
    }),
  });
  return { gateway, alpha, logLines };
}

async function failure(promise: Promise<unknown>): Promise<ModelGatewayError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ModelGatewayError) return error;
    throw error;
  }
  throw new Error("expected the gateway to fail");
}

const EXHAUSTED: FakeBehaviour = {
  kind: "FAIL",
  failureClass: "PERMANENT",
  accountExhausted: true,
};

describe("a blocked provider account is probed, and a top-up takes effect", () => {
  it("one probe per interval across concurrent turns; a success clears the block", async () => {
    const ms = { value: START };
    const { gateway, alpha, logLines } = build(
      [EXHAUSTED, { kind: "TEXT", text: "back" }],
      ms,
    );
    const first = await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(1); // no retry on an exhausted account
    expect(isModelServiceUnavailable(first)).toBe(true);
    // The owner sees it at a glance, naming the provider.
    expect(
      logLines.filter(
        (l) =>
          l.level === "error" && /alpha account exhausted/u.test(l.message),
      ),
    ).toHaveLength(1);

    // Inside the interval: no call at all, and the reason is the provider.
    ms.value = START + 10_000;
    const blocked = await failure(gateway.execute(request()));
    expect(blocked.failureClass).toBe("POLICY_INELIGIBLE");
    expect(blocked.candidates[0]?.reason).toBe("PROVIDER_TEMPORARILY_FAILING");
    expect(isModelServiceUnavailable(blocked)).toBe(true);
    expect(alpha.calls).toHaveLength(1);

    // The owner has topped up. Half a minute on, three turns at once: one
    // probes, the others are turned away without a call.
    ms.value = START + 30_000;
    const settled = await Promise.allSettled([
      gateway.execute(request()),
      gateway.execute(request()),
      gateway.execute(request()),
    ]);
    expect(alpha.calls).toHaveLength(2);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const turnedAway = settled.flatMap((s) =>
      s.status === "rejected" ? [s.reason as unknown] : [],
    );
    for (const reason of turnedAway) {
      expect(reason).toBeInstanceOf(ModelGatewayError);
      expect((reason as ModelGatewayError).failureClass).toBe(
        "POLICY_INELIGIBLE",
      );
      expect(isModelServiceUnavailable(reason)).toBe(true);
    }

    // The probe succeeded: the block is gone at once.
    ms.value = START + 31_000;
    const after = await gateway.execute(request());
    expect(after.providerCode).toBe("alpha");
    expect(alpha.calls).toHaveLength(3);
  });

  it("a probe that finds the account still empty is one call, and the block stays", async () => {
    const ms = { value: START };
    const { gateway, alpha } = build([EXHAUSTED], ms);
    await failure(gateway.execute(request()));
    ms.value = START + 30_000;
    const probe = await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(2);
    expect(isModelServiceUnavailable(probe)).toBe(true);
    ms.value = START + 45_000;
    await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(2);
    ms.value = START + 60_000;
    await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(3);
  });

  it("a refused key is probed the same way, so a fixed key takes effect", async () => {
    const ms = { value: START };
    const { gateway, alpha } = build(
      [
        { kind: "FAIL", failureClass: "AUTHENTICATION" },
        { kind: "TEXT", text: "key fixed" },
      ],
      ms,
    );
    const refused = await failure(gateway.execute(request()));
    expect(refused.failureClass).toBe("AUTHENTICATION");
    expect(isModelServiceUnavailable(refused)).toBe(true);
    ms.value = START + 5_000;
    await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(1);
    ms.value = START + 30_000;
    const fixed = await gateway.execute(request());
    expect(fixed.providerCode).toBe("alpha");
  });
});

describe("process-local health, with a fake clock", () => {
  it("admits one probe per interval while an account is blocked", () => {
    const health = createProcessLocalProviderHealth({
      blockedProbeIntervalMs: 30_000,
    });
    const at = (ms: number) => new Date(START + ms);
    health.recordFailure(
      "openai",
      "gpt-5.6-luna",
      "PERMANENT",
      at(0),
      300,
      true,
    );
    expect(health.state("openai", "gpt-5.6-luna", at(29_999))).toBe(
      "TEMPORARILY_FAILING",
    );
    expect(health.admit?.("openai", "gpt-5.6-luna", at(29_999))).toBe(false);
    // Due: planned healthy, and only the first ask is let through.
    expect(health.state("openai", "gpt-5.6-mini", at(30_000))).toBe("HEALTHY");
    expect(health.admit?.("openai", "gpt-5.6-mini", at(30_000))).toBe(true);
    expect(health.admit?.("openai", "gpt-5.6-luna", at(30_000))).toBe(false);
    expect(health.state("openai", "gpt-5.6-luna", at(30_001))).toBe(
      "TEMPORARILY_FAILING",
    );
    health.recordSuccess("openai", "gpt-5.6-mini", at(30_500));
    expect(health.state("openai", "gpt-5.6-luna", at(30_501))).toBe("HEALTHY");
    expect(health.admit?.("openai", "gpt-5.6-luna", at(30_501))).toBe(true);
    expect(health.admit?.("openai", "gpt-5.6-luna", at(30_502))).toBe(true);
  });
});

describe("whether Q's reasoning service could be reached at all", () => {
  const error = (
    failureClass: ModelGatewayError["failureClass"],
    reasons: readonly string[] = [],
    cause?: unknown,
  ) =>
    new ModelGatewayError("x", {
      failureClass,
      attempts: 0,
      candidates: reasons.map((reason, candidateIndex) => ({
        providerCode: "openai",
        modelCode: "m",
        candidateIndex,
        reason: reason as "ELIGIBLE",
      })),
      cause,
    });

  it("is unavailable for a provider set aside, none configured, or the spend", () => {
    expect(
      isModelServiceUnavailable(
        error("POLICY_INELIGIBLE", [
          "PROVIDER_TEMPORARILY_FAILING",
          "PROVIDER_UNCONFIGURED",
        ]),
      ),
    ).toBe(true);
    expect(
      isModelServiceUnavailable(
        error("POLICY_INELIGIBLE", ["PROVIDER_UNCONFIGURED"]),
      ),
    ).toBe(true);
    expect(isModelServiceUnavailable(error("BUDGET_EXCEEDED"))).toBe(true);
    expect(
      isModelServiceUnavailable(
        error(
          "PERMANENT",
          [],
          new ModelProviderFailure("x", {
            failureClass: "PERMANENT",
            providerCode: "openai",
            accountExhausted: true,
          }),
        ),
      ),
    ).toBe(true);
  });

  it("is not for a model that was asked and gave nothing usable, or for privacy", () => {
    expect(isModelServiceUnavailable(error("TIMEOUT"))).toBe(false);
    expect(isModelServiceUnavailable(error("INVALID_MODEL_OUTPUT"))).toBe(
      false,
    );
    expect(isModelServiceUnavailable(error("CANCELLED"))).toBe(false);
    expect(isModelServiceUnavailable(error("PERMANENT"))).toBe(false);
    expect(
      isModelServiceUnavailable(
        error("POLICY_INELIGIBLE", ["SENSITIVITY_EXCEEDS_CEILING"]),
      ),
    ).toBe(false);
    expect(isModelServiceUnavailable(new Error("x"))).toBe(false);
  });
});
