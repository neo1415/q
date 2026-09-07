import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  Q_ACTION_STATUSES,
  Q_APPROVAL_STATUSES,
  type QActionStatus,
  type QApprovalStatus,
} from "@capital-q/contracts";

import {
  approvalIsOpen,
  approvalIsUsable,
  assertActionTransition,
  assertApprovalTransition,
  canTransitionAction,
  canTransitionApproval,
  createQActionRegistry,
  defineQAction,
  Q_ACTION_TRANSITIONS,
  Q_APPROVAL_TRANSITIONS,
  QActionTransitionError,
  QApprovalTransitionError,
} from "../src/index.js";
import { createTestConfirmRequiredAction } from "../src/testing/index.js";

/**
 * The action and approval state machines (CQ-Q-008 §20-§22, §116) and the
 * registry's refusals (§10, §14-§15, §97). Pure: no database, no clock but
 * the one handed in.
 */

describe("action lifecycle", () => {
  it("covers every status exactly once and makes ended states terminal", () => {
    expect(Object.keys(Q_ACTION_TRANSITIONS).sort()).toEqual(
      [...Q_ACTION_STATUSES].sort(),
    );
    for (const status of [
      "EXECUTED",
      "RECONCILIATION_REQUIRED",
      "REJECTED",
      "EXPIRED",
      "WITHDRAWN",
    ] as const) {
      expect(Q_ACTION_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("allows the legal path and refuses the illegal ones", () => {
    const legal: [QActionStatus, QActionStatus][] = [
      ["PROPOSED", "AWAITING_APPROVAL"],
      ["AWAITING_APPROVAL", "APPROVED"],
      ["AWAITING_APPROVAL", "REJECTED"],
      ["AWAITING_APPROVAL", "EXPIRED"],
      ["AWAITING_APPROVAL", "WITHDRAWN"],
      ["APPROVED", "EXECUTING"],
      ["APPROVED", "EXPIRED"],
      ["EXECUTING", "EXECUTED"],
      ["EXECUTING", "FAILED"],
      ["EXECUTING", "RECONCILIATION_REQUIRED"],
      ["FAILED", "EXECUTING"],
    ];
    for (const [from, to] of legal) {
      expect(canTransitionAction(from, to), `${from} → ${to}`).toBe(true);
    }
    const illegal: [QActionStatus, QActionStatus][] = [
      ["REJECTED", "APPROVED"],
      ["EXPIRED", "APPROVED"],
      ["EXECUTED", "EXECUTING"],
      ["EXECUTED", "APPROVED"],
      ["PROPOSED", "EXECUTING"],
      ["AWAITING_APPROVAL", "EXECUTING"],
      ["AWAITING_APPROVAL", "EXECUTED"],
      ["APPROVED", "EXECUTED"],
      ["RECONCILIATION_REQUIRED", "EXECUTING"],
      ["WITHDRAWN", "AWAITING_APPROVAL"],
    ];
    for (const [from, to] of illegal) {
      expect(canTransitionAction(from, to), `${from} → ${to}`).toBe(false);
      expect(() => assertActionTransition(from, to)).toThrow(
        QActionTransitionError,
      );
    }
  });
});

describe("approval lifecycle", () => {
  it("is decided exactly once", () => {
    expect(Object.keys(Q_APPROVAL_TRANSITIONS).sort()).toEqual(
      [...Q_APPROVAL_STATUSES].sort(),
    );
    for (const to of ["APPROVED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      expect(canTransitionApproval("PENDING", to)).toBe(true);
    }
    const decided: QApprovalStatus[] = [
      "APPROVED",
      "REJECTED",
      "EXPIRED",
      "REVOKED",
    ];
    for (const from of decided) {
      for (const to of Q_APPROVAL_STATUSES) {
        expect(canTransitionApproval(from, to), `${from} → ${to}`).toBe(false);
      }
    }
    expect(() => assertApprovalTransition("REJECTED", "APPROVED")).toThrow(
      QApprovalTransitionError,
    );
  });

  it("evaluates expiry by comparison against an injected instant, never by a sweeper", () => {
    const approval = {
      status: "PENDING" as const,
      expiresAt: "2026-09-05T12:00:00.000Z",
    };
    expect(approvalIsOpen(approval, new Date("2026-09-05T11:59:59.999Z"))).toBe(
      true,
    );
    expect(approvalIsOpen(approval, new Date("2026-09-05T12:00:00.000Z"))).toBe(
      false,
    );
    expect(
      approvalIsOpen(
        { ...approval, status: "APPROVED" },
        new Date("2026-09-05T11:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      approvalIsUsable(
        { ...approval, status: "APPROVED" },
        new Date("2026-09-05T11:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      approvalIsUsable(
        { ...approval, status: "APPROVED" },
        new Date("2026-09-05T12:00:01.000Z"),
      ),
    ).toBe(false);
  });
});

describe("action registry", () => {
  const stub = (overrides: Record<string, unknown>) =>
    defineQAction({
      actionType: "test.stub",
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "test",
      description: "stub",
      payload: z.object({}).strict(),
      result: z.object({}).strict(),
      targets: () => [],
      describe: () => ({ summary: "stub" }),
      authorize: () => Promise.resolve({ outcome: "ALLOW" as const }),
      executor: {
        execute: () =>
          Promise.resolve({ outcome: "EXECUTED" as const, result: {} }),
      },
      ...overrides,
    });

  it("registers the test action and finds it by type only", () => {
    const { definition } = createTestConfirmRequiredAction();
    const registry = createQActionRegistry([definition]);
    expect(registry.get("test.confirm_required")?.version).toBe(1);
    expect(registry.get("RUN_SQL")).toBeUndefined();
    expect(registry.get("bypass.gateq")).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });

  it("refuses prohibited, restricted, read-only and duplicate registrations", () => {
    for (const riskClass of [
      "PROHIBITED",
      "RESTRICTED",
      "SAFE_READ",
      "PREPARE_ONLY",
      "LOW_RISK_INTERNAL",
    ]) {
      expect(
        () => createQActionRegistry([stub({ riskClass })]),
        riskClass,
      ).toThrow(/CONFIRM_REQUIRED/);
    }
    expect(() => createQActionRegistry([stub({}), stub({})])).toThrow(/twice/);
    expect(() => createQActionRegistry([stub({ version: 0 })])).toThrow(
      /version/,
    );
    expect(() =>
      createQActionRegistry([stub({ actionType: "GRANT_ADMIN" })]),
    ).toThrow();
  });
});
