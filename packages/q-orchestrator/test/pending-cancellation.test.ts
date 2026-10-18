import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QRunIdSchema } from "@capital-q/contracts";
import type { QRunRecord, QRunRef } from "@capital-q/q-runtime";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import { settlePendingCancellation } from "../src/orchestrator.js";

/**
 * INC 2026-10-09 (run a7b44b0a): a newer delegation cancelled a run whose
 * answer was already stored; the abort surfaced as an AbortError, the
 * orchestrator's fail was refused (a pending cancel is only ever
 * completed) and the run sat at CANCEL_REQUESTED with no terminal event.
 */

const REF: QRunRef = {
  runId: QRunIdSchema.parse(randomUUID()),
  tenantId: TenantIdSchema.parse(randomUUID()),
  actorUserId: UserIdSchema.parse(randomUUID()),
};

function fakeRuntime(status: QRunRecord["status"]) {
  const finished: QRunRef[] = [];
  return {
    finished,
    readRun: () => Promise.resolve({ status }),
    finishCancellation: (ref: QRunRef) => {
      finished.push(ref);
      return Promise.resolve();
    },
  };
}

describe("a cancellation pending when the invocation ends", () => {
  it.each(["failed", "completed", "answer_failed", "model_not_configured"])(
    "is finished whatever path ended it (%s)",
    async (outcome) => {
      const runtime = fakeRuntime("CANCEL_REQUESTED");
      expect(await settlePendingCancellation(runtime, REF, outcome)).toBe(
        "cancelled",
      );
      expect(runtime.finished).toEqual([REF]);
    },
  );

  it.each(["COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"] as const)(
    "leaves a run that is not cancel-requested alone (%s)",
    async (status) => {
      const runtime = fakeRuntime(status);
      expect(await settlePendingCancellation(runtime, REF, "completed")).toBe(
        "completed",
      );
      expect(runtime.finished).toEqual([]);
    },
  );

  it("leaves a claim another worker holds to that worker", async () => {
    const runtime = fakeRuntime("CANCEL_REQUESTED");
    expect(
      await settlePendingCancellation(runtime, REF, "action_in_progress"),
    ).toBe("action_in_progress");
    expect(runtime.finished).toEqual([]);
  });
});
