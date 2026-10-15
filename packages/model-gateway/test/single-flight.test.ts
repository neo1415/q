import { describe, expect, it } from "vitest";

import type { QToolCallOutcome, QToolProposal } from "@capital-q/q-runtime";

import { createSingleFlight, stableArguments } from "../src/q/single-flight.js";

/**
 * K4: identical concurrent reads within one run share one call; nothing
 * else is shared -- not a write, not another run. Lead 2026-10-16: a read
 * that succeeded is kept for the rest of its run, until a change in the
 * run or the run's end.
 */

const proposal = (
  callId: string,
  args: Record<string, unknown>,
  name = "fit_profile",
): QToolProposal => ({ callId, name, arguments: args });

function counted() {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = (callId: string) => async (): Promise<QToolCallOutcome> => {
    calls += 1;
    await gate;
    return {
      callId,
      toolName: "fit.profile",
      toolVersion: 1,
      classification: "READ_ONLY",
      status: "SUCCEEDED",
      failureCode: null,
      sensitivity: "CONFIDENTIAL",
      result: { ok: true, data: { status: "OK" } },
      latencyMs: 1,
    };
  };
  return { work, release: () => release(), calls: () => calls };
}

describe("single-flight reads (K4)", () => {
  it("shares one call between identical concurrent reads, each with its own call id", async () => {
    const flight = createSingleFlight();
    const fake = counted();
    const first = flight.execute(
      "run-1",
      proposal("a", { companyId: "c1", detail: true }),
      true,
      fake.work("a"),
    );
    const second = flight.execute(
      "run-1",
      proposal("b", { detail: true, companyId: "c1" }),
      true,
      fake.work("b"),
    );
    fake.release();
    const [one, two] = await Promise.all([first, second]);
    expect(fake.calls()).toBe(1);
    expect(one.callId).toBe("a");
    expect(two.callId).toBe("b");
    expect(flight.takeShared("run-1")).toBe(1);
    expect(flight.takeShared("run-1")).toBe(0);
  });

  it("never shares a write or another run's read; keeps this run's finished read", async () => {
    const flight = createSingleFlight();
    const fake = counted();
    fake.release();
    await Promise.all([
      flight.execute("run-1", proposal("a", {}), false, fake.work("a")),
      flight.execute("run-1", proposal("b", {}), false, fake.work("b")),
      flight.execute(
        "run-2",
        proposal("c", { companyId: "c1" }),
        true,
        fake.work("c"),
      ),
      flight.execute(
        "run-3",
        proposal("d", { companyId: "c1" }),
        true,
        fake.work("d"),
      ),
    ]);
    await flight.execute(
      "run-2",
      proposal("e", { companyId: "c1" }),
      true,
      fake.work("e"),
    );
    // "e" is run-2's finished read of the same company: answered from it.
    expect(fake.calls()).toBe(4);
  });

  it("reads again after a change in the run, after the run ends, and after a failure", async () => {
    const flight = createSingleFlight();
    const fake = counted();
    fake.release();
    const read = (id: string) =>
      flight.execute(
        "run-1",
        proposal(id, { companyId: "c1" }),
        true,
        fake.work(id),
      );
    const first = await read("a");
    const again = await read("b");
    expect(again.callId).toBe("b");
    expect(again.result).toEqual(first.result);
    expect(fake.calls()).toBe(1);
    await flight.execute(
      "run-1",
      proposal("w", {}, "express_interest"),
      false,
      fake.work("w"),
    );
    await read("c");
    expect(fake.calls()).toBe(3);
    expect(flight.takeShared("run-1")).toBeGreaterThan(0);
    await read("d");
    expect(fake.calls()).toBe(4);
    let failures = 0;
    const failing = (): Promise<QToolCallOutcome> => {
      failures += 1;
      const outcome: QToolCallOutcome = {
        callId: "f",
        toolName: "fit.profile",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "FAILED",
        failureCode: "NOT_AVAILABLE",
        sensitivity: "CONFIDENTIAL",
        result: { ok: false, error: { code: "NOT_AVAILABLE", message: "x" } },
        latencyMs: 1,
      };
      return Promise.resolve(outcome);
    };
    await flight.execute("run-9", proposal("f1", {}), true, failing);
    await flight.execute("run-9", proposal("f2", {}), true, failing);
    expect(failures).toBe(2);
  });

  it("keys arguments whatever their order", () => {
    expect(stableArguments({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      stableArguments({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
  });
});
