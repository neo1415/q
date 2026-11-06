import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createProcessLocalProviderHealth,
  createStaticModelCatalog,
  ModelGatewayError,
  type FakeBehaviour,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Live 2026-11-05 22:50–23:10: OpenAI credit ran out, the owner topped up,
 * and q-api still answered "I can't reach my reasoning service" until a
 * restart. One turn asks several models at once (skim, early reading,
 * reading, speculation); only one could be the block's probe, the others
 * were turned away at once and the turn failed, and the probe's own
 * request was cancelled with the turn, so it never reported a verdict.
 * Every later turn met the same block until it lapsed, ten minutes after
 * the last refusal.
 */

const START = Date.parse("2026-11-05T22:50:00.000Z");

const EXHAUSTED: FakeBehaviour = {
  kind: "FAIL",
  failureClass: "PERMANENT",
  accountExhausted: true,
};

function build(
  script: readonly FakeBehaviour[],
  ms: { value: number },
  probeWaitMs = 2_000,
) {
  const alpha = createFakeModelProvider({ code: "alpha", script });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    clock: { now: () => new Date(ms.value) },
    health: createProcessLocalProviderHealth({
      blockedProbeIntervalMs: 30_000,
    }),
    probeWaitMs,
  });
  return { gateway, alpha };
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

describe("a topped-up account is noticed without a restart (5 Nov)", () => {
  it("a probe cancelled with its turn is given back: the next turn probes at once", async () => {
    const ms = { value: START };
    const { gateway, alpha } = build(
      [EXHAUSTED, { kind: "HANG" }, { kind: "TEXT", text: "back" }],
      ms,
    );
    await failure(gateway.execute(request()));
    expect(alpha.calls).toHaveLength(1);

    // Topped up. The probe is the skim of a turn that is then stopped.
    ms.value = START + 30_000;
    const stop = new AbortController();
    const skim = failure(gateway.execute(request(), { signal: stop.signal }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(alpha.calls).toHaveLength(2);
    stop.abort();
    expect((await skim).failureClass).toBe("CANCELLED");

    // One second on, not thirty: the next turn is the probe and is served.
    ms.value = START + 31_000;
    const next = await gateway.execute(request());
    expect(next.providerCode).toBe("alpha");
    expect(alpha.calls).toHaveLength(3);
  });

  it("calls of the same turn wait for the in-flight probe and are served by it", async () => {
    const ms = { value: START };
    const { gateway, alpha } = build(
      [
        EXHAUSTED,
        { kind: "TEXT", text: "probe", delayMs: 20 },
        { kind: "TEXT", text: "reading" },
        { kind: "TEXT", text: "speculation" },
      ],
      ms,
    );
    await failure(gateway.execute(request()));
    ms.value = START + 30_000;
    const settled = await Promise.allSettled([
      gateway.execute(request()),
      gateway.execute(request()),
      gateway.execute(request()),
    ]);
    expect(settled.map((s) => s.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    // One probe went first; the others asked only after it answered.
    expect(alpha.calls).toHaveLength(4);
  });

  it("waiters on a probe that finds the account still empty are turned away fast, with one call", async () => {
    const ms = { value: START };
    const { gateway, alpha } = build([EXHAUSTED], ms, 60_000);
    await failure(gateway.execute(request()));
    ms.value = START + 30_000;
    const started = Date.now();
    const settled = await Promise.allSettled([
      gateway.execute(request()),
      gateway.execute(request()),
    ]);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(alpha.calls).toHaveLength(2);
  });

  it("a probe the account answered, even with an unusable reply, ends the block", async () => {
    const ms = { value: START };
    const { gateway } = build(
      [
        EXHAUSTED,
        { kind: "FAIL", failureClass: "INVALID_MODEL_OUTPUT" },
        { kind: "TEXT", text: "fine" },
      ],
      ms,
    );
    await failure(gateway.execute(request()));
    ms.value = START + 30_000;
    await failure(
      gateway.execute(
        request({
          budget: {
            maxAttempts: 1,
            maxEstimatedCostUsd: 0.5,
            maxOutputTokens: 256,
            attemptTimeoutMs: 1_000,
          },
        }),
      ),
    );
    ms.value = START + 31_000;
    const next = await gateway.execute(request());
    expect(next.providerCode).toBe("alpha");
  });

  it("a waiter never outlasts its own bound when the probe hangs", async () => {
    const ms = { value: START };
    const { gateway } = build([EXHAUSTED, { kind: "HANG" }], ms, 50);
    await failure(gateway.execute(request()));
    ms.value = START + 30_000;
    const stop = new AbortController();
    const probe = failure(gateway.execute(request(), { signal: stop.signal }));
    await new Promise((resolve) => setImmediate(resolve));
    const waiter = await failure(gateway.execute(request()));
    expect(waiter.failureClass).toBe("POLICY_INELIGIBLE");
    stop.abort();
    await probe;
  });
});
