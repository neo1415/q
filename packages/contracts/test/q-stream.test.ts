import { describe, expect, it } from "vitest";

import {
  isDurableQStreamEvent,
  isDurableQStreamEventType,
  isTerminalQStreamEvent,
  Q_STREAM_DELTA_MAX_LENGTH,
  Q_STREAM_DURABLE_EVENT_TYPES,
  Q_STREAM_EPHEMERAL_EVENT_TYPES,
  Q_STREAM_EVENT_TYPES,
  Q_STREAM_TERMINAL_EVENT_TYPES,
  QStreamEventSchema,
  type QStreamEvent,
} from "../src/q/stream.js";
import {
  LAST_EVENT_ID_HEADER,
  LastEventIdHeaderSchema,
  Q_RUN_EVENTS_SUFFIX,
  Q_SSE_CONTENT_TYPE,
} from "../src/q/http.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const NOW = "2026-09-05T10:00:00Z";

const base = {
  contractVersion: 1,
  eventId: UUID,
  runId: UUID_2,
  sequence: 1,
  occurredAt: NOW,
};

const publicFailure = {
  code: "Q_TIMEOUT",
  message: "Q is taking longer than expected right now. Please try again.",
  retryable: true,
  runId: UUID_2,
};

/** One valid fixture per event type. The test below proves this covers the union. */
const EVENT_FIXTURES: Readonly<Record<string, unknown>> = {
  "q.run.started": {
    ...base,
    type: "q.run.started",
    data: { capability: "INVESTIGATE", status: "RECEIVED" },
  },
  "q.stage.changed": {
    ...base,
    type: "q.stage.changed",
    data: { stage: "CHECKING_EVIDENCE" },
  },
  "q.message.delta": {
    ...base,
    type: "q.message.delta",
    data: { messageId: UUID, text: "Runway is " },
  },
  "q.message.completed": {
    ...base,
    type: "q.message.completed",
    data: {
      message: {
        messageId: UUID,
        runId: UUID_2,
        role: "Q",
        text: "Runway is approximately 14 months.",
        createdAt: NOW,
      },
    },
  },
  "q.finding.available": {
    ...base,
    type: "q.finding.available",
    data: {
      finding: {
        findingId: UUID,
        type: "GAP",
        statement: "No management accounts newer than March were found.",
        truthClass: "Q_INFERENCE",
        evidenceStatus: "NO_EVIDENCE",
        confidence: "INSUFFICIENT_EVIDENCE",
        evidenceRefs: [],
        subjects: [{ kind: "COMPANY", companyId: UUID }],
      },
    },
  },
  "q.action.proposed": {
    ...base,
    type: "q.action.proposed",
    data: {
      proposal: {
        contractVersion: 1,
        proposalId: UUID,
        runId: UUID_2,
        actionType: "message.send",
        actionClass: "CONFIRM_REQUIRED",
        targets: [
          { kind: "INVESTOR_ORGANISATION", investorOrganisationId: UUID },
        ],
        summary: "Send an introduction to Northgate Capital.",
        approval: { required: true },
        status: "PROPOSED",
        createdAt: NOW,
      },
    },
  },
  "q.approval.required": {
    ...base,
    type: "q.approval.required",
    data: { proposalId: UUID, approvalId: UUID_2 },
  },
  "q.input.required": {
    ...base,
    type: "q.input.required",
    data: {
      clarification: {
        kind: "CLARIFICATION_REQUEST",
        question: "Which Apex do you mean?",
        options: ["Apex Robotics", "Apex Health"],
      },
    },
  },
  "q.run.completed": {
    ...base,
    type: "q.run.completed",
    data: { status: "COMPLETED", completedAt: NOW },
  },
  "q.run.failed": {
    ...base,
    type: "q.run.failed",
    data: { status: "FAILED", failure: publicFailure },
  },
};

describe("QStreamEvent", () => {
  it("has a fixture for every event type, and every fixture parses", () => {
    expect(Object.keys(EVENT_FIXTURES).sort()).toEqual(
      [...Q_STREAM_EVENT_TYPES].sort(),
    );
    for (const [type, fixture] of Object.entries(EVENT_FIXTURES)) {
      expect(QStreamEventSchema.safeParse(fixture).success, type).toBe(true);
    }
  });

  it("requires event id, run id, sequence and time on every event", () => {
    const started = EVENT_FIXTURES["q.run.started"] as Record<string, unknown>;
    for (const field of [
      "eventId",
      "runId",
      "sequence",
      "occurredAt",
      "contractVersion",
    ]) {
      const { [field]: _omitted, ...without } = started;
      expect(QStreamEventSchema.safeParse(without).success, field).toBe(false);
    }
  });

  it("orders by a positive integer sequence", () => {
    const started = EVENT_FIXTURES["q.run.started"] as Record<string, unknown>;
    for (const sequence of [0, -1, 1.5, "1"]) {
      expect(
        QStreamEventSchema.safeParse({ ...started, sequence }).success,
      ).toBe(false);
    }
    expect(
      QStreamEventSchema.safeParse({ ...started, sequence: 4096 }).success,
    ).toBe(true);
  });

  it("bounds a delta frame", () => {
    const delta = EVENT_FIXTURES["q.message.delta"] as { data: object };
    expect(
      QStreamEventSchema.safeParse({
        ...delta,
        data: { messageId: UUID, text: "x".repeat(Q_STREAM_DELTA_MAX_LENGTH) },
      }).success,
    ).toBe(true);
    expect(
      QStreamEventSchema.safeParse({
        ...delta,
        data: {
          messageId: UUID,
          text: "x".repeat(Q_STREAM_DELTA_MAX_LENGTH + 1),
        },
      }).success,
    ).toBe(false);
  });

  it("carries only the public failure projection on q.run.failed", () => {
    const failed = EVENT_FIXTURES["q.run.failed"] as {
      data: { status: string };
    };
    for (const leak of [
      { diagnosticCode: "MODEL_PROVIDER_TIMEOUT" },
      { detail: "upstream 504 from provider" },
      { stack: "Error: at ..." },
      { providerErrorKind: "UNAVAILABLE" },
    ]) {
      expect(
        QStreamEventSchema.safeParse({
          ...failed,
          data: { status: "FAILED", failure: { ...publicFailure, ...leak } },
        }).success,
      ).toBe(false);
    }
  });

  it("has no reasoning, scratchpad or specialist event", () => {
    for (const type of [
      "q.chain_of_thought",
      "q.internal_reasoning",
      "q.specialist_secret_notes",
      "q.thinking",
      "q.node.entered",
    ]) {
      expect(
        QStreamEventSchema.safeParse({ ...base, type, data: { text: "..." } })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a payload that does not match its type", () => {
    expect(
      QStreamEventSchema.safeParse({
        ...base,
        type: "q.stage.changed",
        data: { stage: "Thinking about the founder..." },
      }).success,
    ).toBe(false);
    expect(
      QStreamEventSchema.safeParse({
        ...base,
        type: "q.stage.changed",
        data: { stage: "CHECKING_EVIDENCE", reasoning: "..." },
      }).success,
    ).toBe(false);
  });

  it("knows which events end the stream", () => {
    for (const fixture of Object.values(EVENT_FIXTURES)) {
      const event = QStreamEventSchema.parse(fixture);
      expect(isTerminalQStreamEvent(event)).toBe(
        event.type === "q.run.completed" || event.type === "q.run.failed",
      );
    }
  });

  it("is exhaustively discriminated at the type level", () => {
    // If a member is added to the union without a case here, this stops
    // compiling -- which is the point.
    const describe = (event: QStreamEvent): string => {
      switch (event.type) {
        case "q.run.started":
          return event.data.capability;
        case "q.stage.changed":
          return event.data.stage;
        case "q.message.delta":
          return event.data.text;
        case "q.message.completed":
          return event.data.message.messageId;
        case "q.finding.available":
          return event.data.finding.findingId;
        case "q.action.proposed":
          return event.data.proposal.proposalId;
        case "q.approval.required":
          return event.data.approvalId;
        case "q.input.required":
          return event.data.clarification.question;
        case "q.run.completed":
          return event.data.completedAt;
        case "q.run.failed":
          return event.data.failure.code;
        default: {
          const unreachable: never = event;
          return unreachable;
        }
      }
    };

    const started = QStreamEventSchema.parse(EVENT_FIXTURES["q.run.started"]);
    expect(describe(started)).toBe("INVESTIGATE");
  });
});

describe("stream transport classification (CQ-Q-009)", () => {
  it("partitions every event type into exactly one of durable or ephemeral", () => {
    const durable = [...Q_STREAM_DURABLE_EVENT_TYPES];
    const ephemeral = [...Q_STREAM_EPHEMERAL_EVENT_TYPES];
    expect([...durable, ...ephemeral].sort()).toEqual(
      [...Q_STREAM_EVENT_TYPES].sort(),
    );
    expect(ephemeral).toEqual(["q.message.delta"]);
    for (const type of durable) {
      expect(isDurableQStreamEventType(type), type).toBe(true);
    }
    expect(isDurableQStreamEventType("q.message.delta")).toBe(false);
    // Terminal events are durable: the stream ends on persisted truth.
    for (const type of Q_STREAM_TERMINAL_EVENT_TYPES) {
      expect(durable).toContain(type);
    }
  });

  it("classifies parsed events the same way", () => {
    for (const [type, fixture] of Object.entries(EVENT_FIXTURES)) {
      const event = QStreamEventSchema.parse(fixture);
      expect(isDurableQStreamEvent(event), type).toBe(
        type !== "q.message.delta",
      );
    }
  });

  it("names the SSE surface and validates Last-Event-ID strictly", () => {
    expect(Q_RUN_EVENTS_SUFFIX).toBe("/events");
    expect(Q_SSE_CONTENT_TYPE).toBe("text/event-stream");
    expect(LAST_EVENT_ID_HEADER).toBe("last-event-id");
    expect(LastEventIdHeaderSchema.parse("0")).toBe(0);
    expect(LastEventIdHeaderSchema.parse("42")).toBe(42);
    expect(LastEventIdHeaderSchema.parse("9999999999")).toBe(9_999_999_999);
    for (const bad of [
      "-1",
      "1.5",
      "01",
      "",
      " 1",
      "1e3",
      "99999999999",
      "1; drop table q_runtime.run_events",
      '{"sequence":1}',
      "run:1",
      "0x10",
      "NaN",
      "Infinity",
    ]) {
      expect(LastEventIdHeaderSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
