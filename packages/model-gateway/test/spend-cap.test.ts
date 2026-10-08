import { describe, expect, it } from "vitest";

import {
  createDailySpendCap,
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  ModelGatewayError,
  parseDailySpendCapUsd,
} from "../src/index.js";
import { request, testCatalog } from "./fixtures.js";

/** Audit F-D8: an aggregate daily ceiling across every model call. */

function clockAt(iso: string) {
  let now = new Date(iso);
  return {
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("the daily spend cap", () => {
  it("admits under the cap and refuses at it, counting this process's attempts between reads", async () => {
    const clock = clockAt("2026-10-08T10:00:00Z");
    let reads = 0;
    const cap = createDailySpendCap({
      capUsd: 1,
      now: clock.now,
      readSpentSinceUsd: () => {
        reads += 1;
        return Promise.resolve(0.9);
      },
    });
    expect(await cap.check()).toEqual({ allowed: true });
    cap.note(0.05);
    expect(await cap.check()).toEqual({ allowed: true });
    cap.note(0.05);
    expect(await cap.check()).toEqual({
      allowed: false,
      capUsd: 1,
      spentUsd: expect.closeTo(1, 6) as unknown,
    });
    // One ledger read per refresh interval, not one per request.
    expect(reads).toBe(1);
  });

  it("asks the ledger for the current UTC day, and starts over at midnight", async () => {
    const clock = clockAt("2026-10-08T23:59:30Z");
    const days: string[] = [];
    const cap = createDailySpendCap({
      capUsd: 1,
      now: clock.now,
      readSpentSinceUsd: (dayStart) => {
        days.push(dayStart.toISOString());
        return Promise.resolve(days.length === 1 ? 5 : 0);
      },
    });
    expect((await cap.check()).allowed).toBe(false);
    clock.advance(60_000);
    expect((await cap.check()).allowed).toBe(true);
    expect(days).toEqual([
      "2026-10-08T00:00:00.000Z",
      "2026-10-09T00:00:00.000Z",
    ]);
  });

  it("keeps the last known total when a ledger read fails, and admits if it never read one", async () => {
    const clock = clockAt("2026-10-08T10:00:00Z");
    let fail = true;
    const failures: unknown[] = [];
    const cap = createDailySpendCap({
      capUsd: 1,
      now: clock.now,
      refreshMs: 1_000,
      readSpentSinceUsd: () =>
        fail ? Promise.reject(new Error("db down")) : Promise.resolve(2),
      onReadFailure: (error) => failures.push(error),
    });
    expect(await cap.check()).toEqual({ allowed: true });
    fail = false;
    clock.advance(1_000);
    expect((await cap.check()).allowed).toBe(false);
    fail = true;
    clock.advance(1_000);
    expect((await cap.check()).allowed).toBe(false);
    expect(failures).toHaveLength(2);
  });

  it("reads CQ_MODEL_DAILY_SPEND_CAP_USD strictly", () => {
    expect(parseDailySpendCapUsd({})).toBeUndefined();
    expect(parseDailySpendCapUsd({ CQ_MODEL_DAILY_SPEND_CAP_USD: " " })).toBe(
      undefined,
    );
    expect(parseDailySpendCapUsd({ CQ_MODEL_DAILY_SPEND_CAP_USD: "2.5" })).toBe(
      2.5,
    );
    expect(() =>
      parseDailySpendCapUsd({ CQ_MODEL_DAILY_SPEND_CAP_USD: "2,5" }),
    ).toThrow();
    expect(() =>
      parseDailySpendCapUsd({ CQ_MODEL_DAILY_SPEND_CAP_USD: "-1" }),
    ).toThrow();
    expect(() =>
      parseDailySpendCapUsd({ CQ_MODEL_DAILY_SPEND_CAP_USD: "5000" }),
    ).toThrow();
  });
});

describe("the gateway under a daily cap", () => {
  function build(spentUsd: number) {
    const alpha = createFakeModelProvider({
      code: "alpha",
      script: [{ kind: "TEXT", text: "alpha says hello" }],
    });
    const beta = createFakeModelProvider({
      code: "beta",
      script: [{ kind: "TEXT", text: "beta says hello" }],
    });
    const lines: unknown[] = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (fields: unknown, message: string) =>
        lines.push([fields, message]),
      child: () => logger,
    };
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([alpha, beta]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
      random: () => 0.5,
      logger,
      spendCap: createDailySpendCap({
        capUsd: 1,
        readSpentSinceUsd: () => Promise.resolve(spentUsd),
      }),
    });
    return { gateway, alpha, beta, lines };
  }

  it("refuses before any provider is called, with BUDGET_EXCEEDED and one structured line", async () => {
    const { gateway, alpha, beta, lines } = build(1.2);
    const error = await gateway
      .execute(request({ taskClass: "NORMAL_DIALOGUE" }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelGatewayError);
    expect((error as ModelGatewayError).failureClass).toBe("BUDGET_EXCEEDED");
    expect(alpha.calls).toHaveLength(0);
    expect(beta.calls).toHaveLength(0);
    expect(lines).toEqual([
      [
        expect.objectContaining({
          qFailureClass: "BUDGET",
          spendCap: "DAILY_AGGREGATE",
          capUsd: 1,
          spentUsd: 1.2,
        }),
        "daily model spend cap reached; request refused",
      ],
    ]);
  });

  it("answers normally under the cap", async () => {
    const { gateway } = build(0.1);
    const result = await gateway.execute(
      request({ taskClass: "NORMAL_DIALOGUE" }),
    );
    expect(result.providerCode).toBe("alpha");
  });
});
