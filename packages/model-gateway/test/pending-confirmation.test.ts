import { describe, expect, it } from "vitest";

import type { QToolCallOutcome } from "@capital-q/q-runtime";

import { PREPARED_FOR_APPROVAL_LINE } from "../src/q/index.js";
import {
  forModelReading,
  PENDING_CONFIRMATION,
} from "../src/q/pending-confirmation.js";

/**
 * K9 / G-D23: a staged proposal is read by the model as proposed, pending
 * confirmation -- the Approval Engine saves it after the answer and may
 * refuse it -- so Q never says a card is ready that was never saved.
 */

const outcome = (data: unknown, ok = true): QToolCallOutcome =>
  ({
    callId: "c1",
    toolName: "q.errand.propose",
    toolVersion: 1,
    classification: "SIDE_EFFECT",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "CONFIDENTIAL",
    result: ok
      ? { ok: true, data }
      : { ok: false, error: { code: "TOOL_FAILED" } },
    latencyMs: 1,
  }) as QToolCallOutcome;

describe("a staged proposal as the model reads it (K9)", () => {
  it("PREPARED from a side-effect tool reads as pending confirmation, with the rule", () => {
    const read = forModelReading(
      outcome({ status: "PREPARED", summary: "Book a call with Kora" }),
      "SIDE_EFFECT",
    );
    expect(read.result).toMatchObject({
      ok: true,
      data: {
        status: PENDING_CONFIRMATION,
        summary: "Book a call with Kora",
      },
    });
    const guidance = (read.result as { data: { guidance: string } }).data
      .guidance;
    expect(guidance).toMatch(/never say it is ready, saved, prepared or done/u);
  });

  it("leaves reads, other statuses and failures as they are", () => {
    const prepared = outcome({ status: "PREPARED" });
    expect(forModelReading(prepared, "READ_ONLY")).toBe(prepared);
    expect(forModelReading(prepared, undefined)).toBe(prepared);
    const other = outcome({ status: "ONE_PER_TURN" });
    expect(forModelReading(other, "SIDE_EFFECT")).toBe(other);
    const failed = outcome(null, false);
    expect(forModelReading(failed, "SIDE_EFFECT")).toBe(failed);
  });

  it("the code line for an emptied answer proposes, never claims the card is there", () => {
    expect(PREPARED_FOR_APPROVAL_LINE).toMatch(/^I've proposed that/u);
    expect(PREPARED_FOR_APPROVAL_LINE).toMatch(/once it's saved/u);
  });
});
