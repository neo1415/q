import { describe, expect, it } from "vitest";

import {
  CorrelationIdSchema,
  QActionProposalIdSchema,
  QRunIdSchema,
} from "@capital-q/contracts";
import {
  QRunAlreadyTerminalError,
  QRunNotResumableError,
  type QOrchestrator,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createApprovedContinuation } from "../src/composition/approved-continuation.js";

/**
 * Live 2026-09-28 #4: an approval whose run could no longer resume stayed
 * "approval needed" forever. The continuation resumes when it can and
 * otherwise executes through the same gate; any other fault is not hidden.
 */
const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-0000000000b1",
  tenantId: "00000000-0000-4000-8000-00000000000a",
  organisationId: "00000000-0000-4000-8000-0000000000b2",
  membershipId: "00000000-0000-4000-8000-0000000000b3",
  actorType: "HUMAN",
});
const input = {
  actor,
  runId: QRunIdSchema.parse("00000000-0000-4000-8000-0000000000e2"),
  actionId: QActionProposalIdSchema.parse(
    "00000000-0000-4000-8000-0000000000e1",
  ),
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-000000000001",
  ),
};

function world(resume: () => Promise<never>) {
  const executed: string[] = [];
  const resumed: string[] = [];
  const orchestrator: QOrchestrator = {
    start: () => Promise.reject(new Error("unused")),
    cancel: () => Promise.reject(new Error("unused")),
    resume: (request) => {
      resumed.push(request.runId);
      return resume();
    },
  };
  const continueApproved = createApprovedContinuation({
    orchestrator: () => orchestrator,
    actions: {
      executeApproved: (context) => {
        executed.push(context.actionId);
        return Promise.resolve({ kind: "EXECUTED" });
      },
    },
  });
  return { continueApproved, executed, resumed };
}

describe("createApprovedContinuation", () => {
  it("resumes the paused run when it can, and executes nothing itself", async () => {
    const { continueApproved, executed, resumed } = world(
      () => Promise.resolve({}) as Promise<never>,
    );
    await continueApproved(input);
    expect(resumed).toEqual([input.runId]);
    expect(executed).toEqual([]);
  });

  it("executes through the gate when the resume itself fails the run (live 2026-10-01, 6b04d028)", async () => {
    const { continueApproved, executed, resumed } = world(
      () => Promise.resolve({ status: "FAILED" }) as Promise<never>,
    );
    await continueApproved(input);
    expect(resumed).toEqual([input.runId]);
    expect(executed).toEqual([input.actionId]);
  });

  it("does not execute again when the resumed run completed", async () => {
    const { continueApproved, executed } = world(
      () => Promise.resolve({ status: "COMPLETED" }) as Promise<never>,
    );
    await continueApproved(input);
    expect(executed).toEqual([]);
  });

  it.each([
    ["not resumable", () => new QRunNotResumableError("COMPLETED")],
    ["already terminal", () => new QRunAlreadyTerminalError("FAILED")],
  ])("executes through the gate when the run is %s", async (_label, error) => {
    const { continueApproved, executed } = world(() => Promise.reject(error()));
    await continueApproved(input);
    expect(executed).toEqual([input.actionId]);
  });

  it("does not paper over any other failure", async () => {
    const { continueApproved, executed } = world(() =>
      Promise.reject(new Error("database down")),
    );
    await expect(continueApproved(input)).rejects.toThrow("database down");
    expect(executed).toEqual([]);
  });
});
