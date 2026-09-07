import { describe, expect, it } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

import {
  createQStreamState,
  describeQStage,
  reduceQStream,
} from "../src/q-stream-reducer.js";

/**
 * The client-side reducer (CQ-Q-009 §78-§86): deterministic, keyed by
 * stable identity, and never a second source of truth. Replayed durable
 * events upsert; the persisted message replaces the live buffer.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const MSG = "123e4567-e89b-12d3-a456-426614174000";
const MSG_2 = "123e4567-e89b-12d3-a456-426614174001";
const NOW = "2026-09-06T10:00:00.000Z";

let counter = 0;
function event(
  type: QStreamEvent["type"],
  data: Record<string, unknown>,
  sequence?: number,
): QStreamEvent {
  counter += 1;
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: `${counter.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    runId: RUN,
    sequence: sequence ?? counter,
    occurredAt: NOW,
    type,
    data,
  });
}

const started = () =>
  event("q.run.started", { capability: "INVESTIGATE", status: "RECEIVED" }, 1);
const stage = (s: string, seq: number) =>
  event("q.stage.changed", { stage: s }, seq);
const delta = (text: string, messageId = MSG) =>
  event("q.message.delta", { messageId, text }, 3);
const completed = (text: string, seq: number, messageId = MSG) =>
  event(
    "q.message.completed",
    { message: { messageId, runId: RUN, role: "Q", text, createdAt: NOW } },
    seq,
  );

describe("reduceQStream", () => {
  it("builds presentation state from durable events and tracks the cursor", () => {
    let state = createQStreamState();
    state = reduceQStream(state, started());
    state = reduceQStream(state, stage("UNDERSTANDING_REQUEST", 2));
    state = reduceQStream(state, stage("REVIEWING_COMPANY", 3));
    expect(state.runId).toBe(RUN);
    expect(state.capability).toBe("INVESTIGATE");
    expect(state.stage).toBe("REVIEWING_COMPANY");
    expect(state.lastSequence).toBe(3);
    expect(state.terminal).toBe(false);
  });

  it("accumulates deltas into a partial buffer that the persisted message replaces", () => {
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(state, delta("Runway is "));
    state = reduceQStream(state, delta("about 14 "));
    expect(state.partial).toEqual({
      messageId: MSG,
      text: "Runway is about 14 ",
    });
    // Deltas never move the durable cursor.
    expect(state.lastSequence).toBe(1);
    // Some deltas were lost on the wire; the persisted message wins anyway.
    state = reduceQStream(state, completed("Runway is about 14 months.", 4));
    expect(state.partial).toBeNull();
    expect(state.messages.map((m) => m.text)).toEqual([
      "Runway is about 14 months.",
    ]);
    expect(state.lastSequence).toBe(4);
    // A late delta for a completed message is ignored.
    state = reduceQStream(state, delta("stale"));
    expect(state.partial).toBeNull();
  });

  it("does not duplicate a replayed message, finding or proposal", () => {
    let state = reduceQStream(createQStreamState(), started());
    const done = completed("Final.", 4);
    state = reduceQStream(state, done);
    state = reduceQStream(state, done);
    expect(state.messages).toHaveLength(1);
    const finding = event(
      "q.finding.available",
      {
        finding: {
          findingId: MSG_2,
          type: "GAP",
          statement: "No accounts newer than March.",
          truthClass: "Q_INFERENCE",
          evidenceStatus: "NO_EVIDENCE",
          confidence: "INSUFFICIENT_EVIDENCE",
          evidenceRefs: [],
          subjects: [{ kind: "COMPANY", companyId: MSG }],
        },
      },
      5,
    );
    state = reduceQStream(state, finding);
    state = reduceQStream(state, finding);
    expect(state.findings).toHaveLength(1);
  });

  it("records an approval by identity and clears it when the run ends", () => {
    let state = reduceQStream(createQStreamState(), started());
    const required = event(
      "q.approval.required",
      { proposalId: MSG, approvalId: MSG_2 },
      5,
    );
    state = reduceQStream(state, required);
    state = reduceQStream(state, required); // replay after refresh
    expect(state.approval).toEqual({
      approvalId: MSG_2,
      proposalId: MSG,
      expiresAt: undefined,
    });
    expect(state.runStatus).toBe("AWAITING_APPROVAL");
    expect(state.stage).toBe("WAITING_FOR_APPROVAL");
    state = reduceQStream(
      state,
      event("q.run.completed", { status: "COMPLETED", completedAt: NOW }, 8),
    );
    expect(state.approval).toBeNull();
    expect(state.terminal).toBe(true);
    expect(state.stage).toBeNull();
  });

  it("keeps a clarification until the run moves on", () => {
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(
      state,
      event(
        "q.input.required",
        {
          clarification: {
            kind: "CLARIFICATION_REQUEST",
            question: "Which Apex?",
            options: ["Apex Robotics", "Apex Health"],
          },
        },
        4,
      ),
    );
    expect(state.clarification?.question).toBe("Which Apex?");
    expect(state.runStatus).toBe("AWAITING_INPUT");
    state = reduceQStream(state, stage("PREPARING_ANALYSIS", 5));
    expect(state.clarification?.question).toBe("Which Apex?");
    state = reduceQStream(
      state,
      event("q.run.completed", { status: "COMPLETED", completedAt: NOW }, 6),
    );
    expect(state.clarification).toBeNull();
  });

  it("discards a half-written answer on cancellation and keeps the public failure", () => {
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(state, delta("Partial thought"));
    state = reduceQStream(
      state,
      event(
        "q.run.failed",
        {
          status: "CANCELLED",
          failure: {
            code: "CANCELLED",
            message: "This request was cancelled.",
            retryable: false,
            runId: RUN,
          },
        },
        4,
      ),
    );
    expect(state.partial).toBeNull();
    expect(state.runStatus).toBe("CANCELLED");
    expect(state.failure?.message).toBe("This request was cancelled.");
    expect(state.terminal).toBe(true);
    // Nothing after a terminal event changes the buffer.
    state = reduceQStream(state, delta("more"));
    expect(state.partial).toBeNull();
  });

  it("is a pure function of its inputs", () => {
    const a = createQStreamState();
    const b = reduceQStream(a, started());
    expect(a).toEqual(createQStreamState());
    expect(b).not.toBe(a);
  });

  it("describes stages in plain English, never the enum", () => {
    expect(describeQStage("WAITING_FOR_APPROVAL")).toBe(
      "Q is waiting for your approval.",
    );
    expect(describeQStage("REVIEWING_COMPANY")).toBe("Reviewing the company");
    expect(describeQStage(null)).toBeNull();
    for (const stageName of [
      "UNDERSTANDING_REQUEST",
      "CHECKING_EVIDENCE",
      "COMPLETING_APPROVED_ACTION",
    ] as const) {
      expect(describeQStage(stageName)).not.toContain("_");
    }
  });
});
