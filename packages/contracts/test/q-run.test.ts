import { describe, expect, it } from "vitest";

import {
  isTerminalQRunStatus,
  Q_RUN_STATUSES,
  Q_RUN_TERMINAL_STATUSES,
  QRunHandleSchema,
  QRunStatusSchema,
  QRunSummarySchema,
} from "../src/q/run.js";
import {
  Q_VISIBLE_STAGE_LABELS,
  Q_VISIBLE_STAGES,
  qVisibleStageLabel,
  QVisibleStageSchema,
} from "../src/q/stage.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-05T10:00:00Z";
const LATER = "2026-09-05T10:00:05Z";

describe("QRunStatus", () => {
  it.each(Q_RUN_STATUSES)("parses %s", (status) => {
    expect(QRunStatusSchema.parse(status)).toBe(status);
  });

  it.each([
    "THINKING",
    "completed",
    "RUNNING",
    "",
    "Understanding your request",
  ])("rejects %j", (value) => {
    expect(QRunStatusSchema.safeParse(value).success).toBe(false);
  });

  it("names exactly four terminal states, all of which are statuses", () => {
    expect([...Q_RUN_TERMINAL_STATUSES]).toEqual([
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ]);
    for (const status of Q_RUN_TERMINAL_STATUSES) {
      expect(Q_RUN_STATUSES).toContain(status);
      expect(isTerminalQRunStatus(status)).toBe(true);
    }
  });

  it("treats every other state, including the waiting ones, as live", () => {
    for (const status of Q_RUN_STATUSES) {
      if (!(Q_RUN_TERMINAL_STATUSES as readonly string[]).includes(status)) {
        expect(isTerminalQRunStatus(status)).toBe(false);
      }
    }
    expect(isTerminalQRunStatus("AWAITING_APPROVAL")).toBe(false);
    expect(isTerminalQRunStatus("CANCEL_REQUESTED")).toBe(false);
  });
});

describe("QVisibleStage", () => {
  it.each(Q_VISIBLE_STAGES)("parses %s", (stage) => {
    expect(QVisibleStageSchema.parse(stage)).toBe(stage);
  });

  it("is a separate vocabulary from the machine status", () => {
    // Internal orchestration states are not things a person is shown.
    for (const internal of [
      "RETRIEVAL",
      "SPECIALIST_EXECUTION",
      "SYNTHESIS",
      "VERIFICATION",
      "POLICY_CHECK",
      "PLANNING",
    ]) {
      expect(QRunStatusSchema.safeParse(internal).success).toBe(true);
      expect(QVisibleStageSchema.safeParse(internal).success).toBe(false);
    }
    // And a visible stage is not a run status.
    for (const stage of Q_VISIBLE_STAGES) {
      expect(QRunStatusSchema.safeParse(stage).success).toBe(false);
    }
  });

  it("rejects free text and anything a model might improvise", () => {
    for (const value of [
      "Thinking...",
      "Consulting the founder specialist",
      "langgraph:retrieve_node",
      "",
    ]) {
      expect(QVisibleStageSchema.safeParse(value).success).toBe(false);
    }
  });

  it("maps every stage to a short plain-English label that is not the enum", () => {
    for (const stage of Q_VISIBLE_STAGES) {
      const label = qVisibleStageLabel(stage);
      expect(label).toBe(Q_VISIBLE_STAGE_LABELS[stage]);
      expect(label).not.toBe(stage);
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(60);
      // Not a machine identifier leaking through.
      expect(label).not.toMatch(/_/);
      expect(label).not.toMatch(/^[A-Z0-9_]+$/);
      // Not an implementation concept.
      expect(label).not.toMatch(/agent|graph|model|prompt|specialist|node/i);
    }
  });

  it("uses the wording the architecture approves", () => {
    expect(qVisibleStageLabel("UNDERSTANDING_REQUEST")).toBe(
      "Understanding your request",
    );
    expect(qVisibleStageLabel("CHECKING_EVIDENCE")).toBe("Checking evidence");
    expect(qVisibleStageLabel("WAITING_FOR_APPROVAL")).toBe(
      "Waiting for your approval",
    );
  });
});

describe("QRunHandle", () => {
  it("identifies accepted work without claiming completion", () => {
    const handle = QRunHandleSchema.parse({
      runId: UUID,
      status: "RECEIVED",
      createdAt: NOW,
    });
    expect(handle.status).toBe("RECEIVED");
  });

  it("carries nothing else", () => {
    for (const extra of [
      { graphState: {} },
      { checkpointId: "x" },
      { messages: [] },
      { prompt: "x" },
    ]) {
      expect(
        QRunHandleSchema.safeParse({
          runId: UUID,
          status: "RECEIVED",
          createdAt: NOW,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});

describe("QRunSummary", () => {
  const live = {
    runId: UUID,
    capability: "INVESTIGATE",
    status: "RETRIEVAL",
    visibleStage: "CHECKING_EVIDENCE",
    subjects: [{ kind: "COMPANY", companyId: UUID }],
    createdAt: NOW,
    startedAt: NOW,
  };

  it("parses a live run with a visible stage and no results yet", () => {
    expect(QRunSummarySchema.safeParse(live).success).toBe(true);
  });

  it("parses a completed run with results and no stage", () => {
    expect(
      QRunSummarySchema.safeParse({
        ...live,
        status: "COMPLETED",
        visibleStage: null,
        results: [{ kind: "TEXT", text: "Runway is approximately 14 months." }],
        completedAt: LATER,
      }).success,
    ).toBe(true);
  });

  it("reports a failure only on a failed run", () => {
    const failure = {
      code: "Q_TIMEOUT",
      message: "Q is taking longer than expected right now. Please try again.",
      retryable: true,
    };

    expect(
      QRunSummarySchema.safeParse({
        ...live,
        status: "FAILED",
        visibleStage: null,
        failure,
        completedAt: LATER,
      }).success,
    ).toBe(true);
    expect(QRunSummarySchema.safeParse({ ...live, failure }).success).toBe(
      false,
    );
  });

  it("gives only a terminal run a completion time", () => {
    expect(
      QRunSummarySchema.safeParse({ ...live, completedAt: LATER }).success,
    ).toBe(false);
  });

  it("has no field for graph state, checkpoints, prompts or provider traffic", () => {
    for (const extra of [
      { graphState: {} },
      { checkpoint: {} },
      { prompt: "x" },
      { promptBundleVersion: "1" },
      { providerRequest: {} },
      { providerResponse: {} },
      { model: "x" },
      { toolCalls: [] },
      { reasoning: "x" },
      { tenantId: UUID },
    ]) {
      expect(QRunSummarySchema.safeParse({ ...live, ...extra }).success).toBe(
        false,
      );
    }
  });
});
