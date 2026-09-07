import { describe, expect, it } from "vitest";

import {
  Q_ACTION_CLASSES,
  Q_APPROVAL_STATUSES,
  QActionProposalSchema,
  QActionTypeSchema,
  QApprovalRefSchema,
  QApprovalRequirementSchema,
} from "../src/q/action.js";
import {
  QApprovalIdSchema,
  QRunIdSchema,
  type QApprovalId,
} from "../src/q/ids.js";
import {
  isTerminalQToolCallStatus,
  Q_TOOL_CALL_STATUSES,
  QToolCallRecordSchema,
  QToolNameSchema,
  QToolProgressSchema,
} from "../src/q/tool.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const NOW = "2026-09-05T10:00:00Z";

const proposal = {
  contractVersion: 1,
  proposalId: UUID,
  runId: UUID_2,
  actionType: "message.send",
  actionClass: "CONFIRM_REQUIRED",
  targets: [{ kind: "INVESTOR_ORGANISATION", investorOrganisationId: UUID_2 }],
  summary: "Send an introduction to Northgate Capital.",
  preview: "Hi Sarah, I wanted to introduce Apex Robotics...",
  approval: { required: true },
  status: "PROPOSED",
  createdAt: NOW,
  expiresAt: "2026-09-06T10:00:00Z",
};

describe("QActionProposal", () => {
  it("parses a prepared action awaiting a person", () => {
    const parsed = QActionProposalSchema.parse(proposal);
    expect(parsed.status).toBe("PROPOSED");
    expect(parsed.approval.required).toBe(true);
  });

  it("does not imply approval", () => {
    const parsed = QActionProposalSchema.parse(proposal);
    if (parsed.approval.required) {
      expect(parsed.approval.approval).toBeUndefined();
    }
    // There is no way to say "approved" on the proposal itself.
    expect(
      QActionProposalSchema.safeParse({ ...proposal, approved: true }).success,
    ).toBe(false);
    expect(
      QActionProposalSchema.safeParse({ ...proposal, status: "APPROVED" })
        .success,
    ).toBe(false);
    expect(
      QActionProposalSchema.safeParse({
        ...proposal,
        approval: { required: true, approved: true },
      }).success,
    ).toBe(false);
  });

  it("does not imply execution", () => {
    for (const extra of [
      { executed: true },
      { executedAt: NOW },
      { executionResult: {} },
      { providerMessageId: "msg_x" },
      { idempotencyKey: "x" },
    ]) {
      expect(
        QActionProposalSchema.safeParse({ ...proposal, ...extra }).success,
      ).toBe(false);
    }
  });

  it("can carry a reference to an approval once one exists, without granting anything", () => {
    expect(
      QActionProposalSchema.safeParse({
        ...proposal,
        approval: {
          required: true,
          approval: { approvalId: UUID, status: "PENDING" },
        },
      }).success,
    ).toBe(true);
    expect(
      QApprovalRefSchema.safeParse({ approvalId: UUID, status: "EXECUTED" })
        .success,
    ).toBe(false);
    expect([...Q_APPROVAL_STATUSES]).toEqual([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "EXPIRED",
      "REVOKED",
    ]);
  });

  it("requires approval for the classes that always need a human", () => {
    for (const actionClass of ["CONFIRM_REQUIRED", "RESTRICTED"]) {
      expect(
        QActionProposalSchema.safeParse({
          ...proposal,
          actionClass,
          approval: { required: false },
        }).success,
      ).toBe(false);
    }
    expect(
      QActionProposalSchema.safeParse({
        ...proposal,
        actionClass: "PREPARE_ONLY",
        approval: { required: false },
      }).success,
    ).toBe(true);
  });

  it("never proposes a prohibited action", () => {
    expect(Q_ACTION_CLASSES).toContain("PROHIBITED");
    expect(
      QActionProposalSchema.safeParse({
        ...proposal,
        actionClass: "PROHIBITED",
      }).success,
    ).toBe(false);
  });

  it("carries no arbitrary payload", () => {
    for (const extra of [
      { payload: { recipient: "anyone@example.com" } },
      { arguments: {} },
      { input: {} },
      { rawSql: "delete from core.companies" },
    ]) {
      expect(
        QActionProposalSchema.safeParse({ ...proposal, ...extra }).success,
      ).toBe(false);
    }
  });

  it("targets typed subjects, at least one", () => {
    expect(
      QActionProposalSchema.safeParse({ ...proposal, targets: [] }).success,
    ).toBe(false);
    expect(
      QActionProposalSchema.safeParse({
        ...proposal,
        targets: [{ type: "email", id: "anyone@example.com" }],
      }).success,
    ).toBe(false);
  });

  it("bounds the action type to a dotted name", () => {
    expect(QActionTypeSchema.safeParse("message.send").success).toBe(true);
    expect(QActionTypeSchema.safeParse("send").success).toBe(false);
    expect(QActionTypeSchema.safeParse("Message.Send").success).toBe(false);
    expect(QActionTypeSchema.safeParse("message.send; drop").success).toBe(
      false,
    );
  });

  it("refuses an unknown contract version", () => {
    expect(
      QActionProposalSchema.safeParse({ ...proposal, contractVersion: 2 })
        .success,
    ).toBe(false);
  });
});

describe("QApprovalRequirement", () => {
  it("is either not required, or required with an optional reference", () => {
    expect(
      QApprovalRequirementSchema.safeParse({ required: false }).success,
    ).toBe(true);
    expect(
      QApprovalRequirementSchema.safeParse({ required: true }).success,
    ).toBe(true);
    expect(
      QApprovalRequirementSchema.safeParse({
        required: false,
        approval: { approvalId: UUID, status: "APPROVED" },
      }).success,
    ).toBe(false);
  });
});

describe("Q identifiers are not interchangeable", () => {
  it("keeps a run id from standing in for an approval id", () => {
    const runId = QRunIdSchema.parse(UUID);

    // @ts-expect-error a QRunId is not a QApprovalId; explicit re-parsing is required
    const wrong: QApprovalId = runId;

    expect(typeof wrong).toBe("string");
    expect(QApprovalIdSchema.parse(UUID)).toBe(UUID);
  });
});

describe("Q tool contracts", () => {
  const record = {
    toolCallId: UUID,
    runId: UUID_2,
    toolName: "company.profile.read",
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    requestedAt: NOW,
    completedAt: NOW,
  };

  it("records identity, class and status of a call", () => {
    expect(QToolCallRecordSchema.safeParse(record).success).toBe(true);
  });

  it("carries no arguments or results on the envelope", () => {
    for (const extra of [
      { arguments: { companyId: UUID } },
      { input: {} },
      { output: {} },
      { result: {} },
      { rawResponse: {} },
    ]) {
      expect(
        QToolCallRecordSchema.safeParse({ ...record, ...extra }).success,
      ).toBe(false);
    }
  });

  it("withholds the tool name from the public progress projection", () => {
    const progress = {
      toolCallId: UUID,
      classification: "READ_ONLY",
      status: "EXECUTING",
      occurredAt: NOW,
    };
    expect(QToolProgressSchema.safeParse(progress).success).toBe(true);
    expect(
      QToolProgressSchema.safeParse({
        ...progress,
        toolName: "company.profile.read",
      }).success,
    ).toBe(false);
  });

  it("names tools with a dotted lower_snake_case identifier", () => {
    expect(QToolNameSchema.safeParse("company.profile.read").success).toBe(
      true,
    );
    expect(QToolNameSchema.safeParse("run_sql").success).toBe(false);
    expect(QToolNameSchema.safeParse("Company.Read").success).toBe(false);
  });

  it("knows which call statuses are final", () => {
    for (const status of Q_TOOL_CALL_STATUSES) {
      expect(isTerminalQToolCallStatus(status)).toBe(
        status === "DENIED" || status === "SUCCEEDED" || status === "FAILED",
      );
    }
  });
});
