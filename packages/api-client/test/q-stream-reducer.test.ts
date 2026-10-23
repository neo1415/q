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

  it("shows a holding line until the answer's words or its message take its place (owner 2026-10-23)", () => {
    const HOLD = "123e4567-e89b-12d3-a456-426614174099";
    const holding = event(
      "q.message.delta",
      {
        messageId: HOLD,
        text: "Looking into Zino Aviation now. ",
        holding: true,
      },
      3,
    );
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(state, holding);
    expect(state.partial).toEqual({
      messageId: HOLD,
      text: "Looking into Zino Aviation now. ",
      holding: true,
    });
    // The answer's own words replace it.
    state = reduceQStream(state, delta("Zino Aviation trains pilots. "));
    expect(state.partial).toEqual({
      messageId: MSG,
      text: "Zino Aviation trains pilots. ",
    });
    // A message under another id clears it too, when nothing streamed.
    let quiet = reduceQStream(createQStreamState(), started());
    quiet = reduceQStream(quiet, holding);
    quiet = reduceQStream(quiet, completed("Zino Aviation trains pilots.", 4));
    expect(quiet.partial).toBeNull();
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
    // Owner 2026-10-20: Q says where it is ("reading their deck",
    // "comparing the two"); web research stays neutral (R38).
    expect(describeQStage("REVIEWING_COMPANY")).toBe("Looking at the company");
    expect(describeQStage("CHECKING_EVIDENCE")).toBe(
      "Reading their deck and documents",
    );
    expect(describeQStage("SEARCHING_PUBLIC_SOURCES")).toBe("Looking into it");
    expect(describeQStage("COMPARING_OPPORTUNITIES")).toBe(
      "Comparing them side by side",
    );
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

describe("reduceQStream: artifacts live", () => {
  const COMPANY = "a0000000-0000-4000-8000-00000000000a";
  const preview = (messageId = MSG) =>
    event(
      "q.artifact.preview",
      {
        messageId,
        subjects: [
          { subject: { kind: "COMPANY", companyId: COMPANY }, name: "Baridi" },
        ],
        layout: "CARD",
      },
      3,
    );

  it("holds the live message's preview until that message is persisted", () => {
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(state, preview());
    state = reduceQStream(state, delta("Baridi leads. "));
    expect(state.preview?.subjects[0]?.name).toBe("Baridi");
    // Ephemeral: the durable cursor does not move.
    expect(state.lastSequence).toBe(1);
    state = reduceQStream(state, completed("Baridi leads.", 4));
    expect(state.preview).toBeNull();
    // A late preview for a persisted message is ignored.
    expect(reduceQStream(state, preview()).preview).toBeNull();
  });

  it("drops the preview when the run ends without an answer", () => {
    let state = reduceQStream(createQStreamState(), started());
    state = reduceQStream(state, preview());
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
        5,
      ),
    );
    expect(state.preview).toBeNull();
  });
});

describe("the run's stage history (owner 2026-10-21: stages as they happen)", () => {
  it("keeps every stage the run reported, in order, and the newest is current", async () => {
    const { qStageSteps } = await import("../src/q-stream-reducer.js");
    let state = createQStreamState();
    state = reduceQStream(state, started());
    for (const [name, seq] of [
      ["REVIEWING_COMPANY", 2],
      ["CHECKING_EVIDENCE", 3],
      ["CHECKING_EVIDENCE", 4],
      ["COMPARING_OPPORTUNITIES", 5],
      ["PREPARING_ANALYSIS", 6],
    ] as const) {
      state = reduceQStream(state, stage(name, seq));
    }
    expect(state.stage).toBe("PREPARING_ANALYSIS");
    // A stage reported twice back to back is one step.
    expect(qStageSteps(state.stageHistory)).toEqual([
      "REVIEWING_COMPANY",
      "CHECKING_EVIDENCE",
      "COMPARING_OPPORTUNITIES",
      "PREPARING_ANALYSIS",
    ]);
  });

  it("is replay-safe: a resent stage neither repeats a step nor moves Q backwards", async () => {
    const { qStageSteps } = await import("../src/q-stream-reducer.js");
    let state = createQStreamState();
    state = reduceQStream(state, stage("REVIEWING_COMPANY", 2));
    state = reduceQStream(state, stage("COMPARING_OPPORTUNITIES", 3));
    // The reconnect replays from the start.
    state = reduceQStream(state, stage("REVIEWING_COMPANY", 2));
    state = reduceQStream(state, stage("COMPARING_OPPORTUNITIES", 3));
    expect(state.stageHistory).toHaveLength(2);
    expect(state.stage).toBe("COMPARING_OPPORTUNITIES");
    expect(qStageSteps(state.stageHistory)).toEqual([
      "REVIEWING_COMPANY",
      "COMPARING_OPPORTUNITIES",
    ]);
  });

  it("starts empty: no step is shown before the run reports one", () => {
    expect(createQStreamState().stageHistory).toEqual([]);
  });
});
