import { describe, expect, it } from "vitest";

import { ModelGatewayError } from "@capital-q/model-gateway";

import {
  failedOperation,
  turnFailureLine,
  turnSucceeded,
} from "../src/voice/turn-failure.js";

/**
 * A thrown spoken turn (CQ-QX-005 §6, §7, §8): Q's side, named by the
 * subsystem that failed, never the person's hearing, and never the same
 * sentence twice running however long the outage lasts.
 */
/** Only identity matters: the ledger is keyed by the line's binding object. */
function binding(): object {
  return {};
}

const modelDown = () =>
  new ModelGatewayError("no route", {
    failureClass: "PROVIDER_OUTAGE",
    attempts: 1,
    candidates: [],
    routingPolicyCode: undefined,
  });

describe("a turn that threw", () => {
  it("tells a reasoning failure from any other failure by the error's type", () => {
    expect(failedOperation(modelDown())).toBe("MODEL");
    expect(failedOperation(new Error("fetch failed"))).toBe("TOOL");
  });

  it("never blames the person's words, and never repeats itself back to back", () => {
    const line = binding();
    const said = Array.from({ length: 6 }, () =>
      turnFailureLine(line, new Error("runtime refused")),
    );
    for (const sentence of said) {
      expect(sentence).not.toMatch(/couldn't take that|didn't catch/i);
      expect(sentence).toMatch(/my side/i);
    }
    for (let i = 1; i < said.length; i += 1) {
      expect(said[i]).not.toBe(said[i - 1]);
    }
    // The second failure is the one that says Q is leaving it alone.
    expect(said[1]).toMatch(/leave it for now/i);
  });

  it("names the reasoning service when that is what failed", () => {
    const line = binding();
    expect(turnFailureLine(line, modelDown())).toMatch(/reasoning service/i);
  });

  it("starts again from a first failure once a turn works", () => {
    const line = binding();
    const first = turnFailureLine(line, new Error("x"));
    turnFailureLine(line, new Error("x"));
    turnSucceeded(line);
    expect(turnFailureLine(line, new Error("x"))).toBe(first);
  });
});
