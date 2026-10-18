import { describe, expect, it } from "vitest";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/**
 * Hedged requests (L1 latency sweep, 2026-10-06), configured per routing
 * policy (`hedge_after_ms`, migration 20261207163000). Hosted, the
 * FAST_CLASSIFICATION primary answered at p50 1172 ms / p90 1479 ms, and a
 * stalled or refused one held the turn until its 6 s timeout before any
 * fallback was asked. Timings here are real but scaled down.
 */
function build(
  alpha: readonly FakeBehaviour[],
  beta: readonly FakeBehaviour[],
  hedgeAfterMs: number | null,
) {
  const a = createFakeModelProvider({ code: "alpha", script: alpha });
  const b = createFakeModelProvider({ code: "beta", script: beta });
  const usage = createInMemoryModelUsageRepository();
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((snapshot) => ({
        ...snapshot,
        routingPolicies: snapshot.routingPolicies.map((policy) =>
          policy.code === "normal_dialogue.v1"
            ? { ...policy, hedgeAfterMs }
            : policy,
        ),
      })),
    ),
    registry: createModelProviderRegistry([a, b]),
    usage,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return { gateway, alpha: a, beta: b, usage };
}

const SLOW: FakeBehaviour = { kind: "TEXT", text: "slow first", delayMs: 600 };
const QUICK: FakeBehaviour = {
  kind: "TEXT",
  text: "quick second",
  delayMs: 40,
};

async function timed<T>(run: () => Promise<T>) {
  const started = Date.now();
  const value = await run();
  return { value, ms: Date.now() - started };
}

describe("hedged requests", () => {
  it("before: no hedge configured, a slow first model is waited out (~600 ms)", async () => {
    const { gateway, beta } = build([SLOW], [QUICK], null);
    const { value, ms } = await timed(() => gateway.execute(request()));
    expect(value.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
    expect(ms).toBeGreaterThanOrEqual(550);
  });

  it("after: hedged at 100 ms, the second model's answer is used (~140 ms) and the first is cancelled", async () => {
    const { gateway, alpha, beta } = build([SLOW], [QUICK], 100);
    const { value, ms } = await timed(() => gateway.execute(request()));
    expect(value.providerCode).toBe("beta");
    expect(value.output).toMatchObject({ kind: "TEXT", text: "quick second" });
    expect(value.fallbackUsed).toBe(true);
    expect(alpha.calls).toHaveLength(1);
    expect(beta.calls).toHaveLength(1);
    expect(ms).toBeLessThan(450);
  });

  it("does not hedge a first model that answers in time", async () => {
    const { gateway, beta } = build(
      [{ kind: "TEXT", text: "on time", delayMs: 20 }],
      [QUICK],
      200,
    );
    const result = await gateway.execute(request());
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
  });

  it("keeps the first model's answer when it still wins after the hedge", async () => {
    const { gateway, beta } = build(
      [{ kind: "TEXT", text: "first after all", delayMs: 150 }],
      [{ kind: "TEXT", text: "too late", delayMs: 800 }],
      50,
    );
    const { value, ms } = await timed(() => gateway.execute(request()));
    expect(value.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(1);
    expect(ms).toBeLessThan(600);
  });

  it("never hedges a streamed answer: two models must not both be heard", async () => {
    const { gateway, beta } = build([SLOW], [QUICK], 50);
    const heard: string[] = [];
    const result = await gateway.execute(request(), {
      onTextDelta: (text) => heard.push(text),
    });
    expect(result.providerCode).toBe("alpha");
    expect(beta.calls).toHaveLength(0);
  });

  it("when both fail, the first's failure is judged as before and the request still ends", async () => {
    const { gateway, alpha, beta } = build(
      [{ kind: "HANG" }],
      [{ kind: "FAIL", failureClass: "PERMANENT" }],
      50,
    );
    await expect(gateway.execute(request())).rejects.toThrow();
    expect(alpha.calls.length).toBeGreaterThanOrEqual(1);
    expect(beta.calls.length).toBeGreaterThanOrEqual(1);
  }, 10_000);
});
