// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CommitmentDto,
  RelationshipCommitmentsDto,
  QUiActIntent,
} from "@capital-q/contracts";

/**
 * W5.1 + W5.3 on the relationship's commitment: recording, confirming,
 * withdrawing or adopting money Q heard in a call is binding, so APPROVAL.
 * Q's act prepares it with its exact payload and runs nothing; only the
 * person's approval runs it, once. "Invested" (the money moved) is only
 * ever the person's own choice on the form, never Q's inference.
 */

const stateCommitmentAction = vi.fn();
const confirmCommitmentAction = vi.fn();
const adoptCommitmentAction = vi.fn();
vi.mock("../src/features/relationships/commitment-actions", () => ({
  readCommitmentsAction: () => new Promise(() => undefined),
  stateCommitmentAction: (...args: unknown[]) =>
    stateCommitmentAction(...args) as unknown,
  confirmCommitmentAction: (...args: unknown[]) =>
    confirmCommitmentAction(...args) as unknown,
  adoptCommitmentAction: (...args: unknown[]) =>
    adoptCommitmentAction(...args) as unknown,
  disputeCommitmentAction: vi.fn(),
  withdrawCommitmentAction: vi.fn(),
}));

const { RelationshipCommitment } =
  await import("../src/features/relationships/relationship-commitment");
const { performUiAct, resetUiActController } =
  await import("../src/features/q/ui-act-controller");
const { resetControls } = await import("../src/features/q/control/registry");
const { resetApprovals } = await import("../src/features/q/control/approval");
const {
  approveRequest,
  heldReason,
  resetApprovalRequests,
  subscribeApprovals,
} = await import("../src/features/q/control/approval-requests");

const RELATIONSHIP = "7a000000-0000-4000-8000-000000000001";
const commitment = (patch: Partial<CommitmentDto>): CommitmentDto => ({
  id: "7b000000-0000-4000-8000-000000000001",
  amount: "2000000",
  currencyCode: "USD",
  level: "SOFT",
  status: "STATED",
  source: "PERSON",
  quote: null,
  statedByYourSide: false,
  statedAt: "2026-11-06T10:00:00.000Z",
  confirmedAt: null,
  note: null,
  meetingId: null,
  canConfirm: true,
  canWithdraw: false,
  canAdopt: false,
  canDispute: false,
  ...patch,
});
const dto = (
  patch: Partial<RelationshipCommitmentsDto>,
): RelationshipCommitmentsDto => ({
  current: null,
  history: [],
  detected: [],
  connected: true,
  ...patch,
});

let n = 0;
const activate = (target: string): QUiActIntent => {
  n += 1;
  return {
    kind: "UI_ACT",
    actId: `uia_commit${String(n)}xx`,
    act: "ACTIVATE",
    target,
  };
};

let pending: readonly { id: string; payload: Record<string, unknown> }[] = [];
beforeEach(() => {
  resetControls();
  resetUiActController();
  resetApprovals();
  resetApprovalRequests();
  pending = [];
  subscribeApprovals((requests) => {
    pending = requests;
  });
  for (const fn of [
    stateCommitmentAction,
    confirmCommitmentAction,
    adoptCommitmentAction,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue({ ok: true, value: dto({}) });
  }
});
afterEach(() => cleanup());

describe("Q and the relationship's commitment", () => {
  it("confirming the other side's commitment: Q prepares it, only the approval runs it, once", async () => {
    render(
      <RelationshipCommitment
        relationshipId={RELATIONSHIP}
        counterpart="Ledgerfold"
        initial={dto({ current: commitment({}) })}
      />,
    );
    const step = activate("button.commitment-confirm");
    const receipt = await performUiAct(step);
    // Owner replay batch 7 (#9): prepared, waiting for approval.
    expect(receipt.status).toBe("AWAITING_APPROVAL");
    expect(heldReason(step.actId)).toBe("AWAITING_APPROVAL");
    expect(confirmCommitmentAction).not.toHaveBeenCalled();
    expect(pending[0]?.payload).toEqual({
      with: "Ledgerfold",
      amount: "2000000",
      currency: "USD",
      level: "Soft",
    });
    const id = pending[0]?.id ?? "";
    await act(async () => {
      await approveRequest(id);
    });
    expect(confirmCommitmentAction).toHaveBeenCalledTimes(1);
    // The same approval again (a double tap): nothing runs twice.
    await act(async () => {
      await approveRequest(id);
    });
    expect(confirmCommitmentAction).toHaveBeenCalledTimes(1);
  });

  it("money Q heard in a call: Q proposes recording it; nothing is recorded until approved", async () => {
    render(
      <RelationshipCommitment
        relationshipId={RELATIONSHIP}
        counterpart="Ledgerfold"
        initial={dto({
          detected: [
            commitment({
              id: "7c000000-0000-4000-8000-000000000001",
              status: "DETECTED",
              source: "Q_MEETING",
              quote: "we're thinking two million",
              canConfirm: false,
              canAdopt: true,
              canDispute: true,
            }),
          ],
        })}
      />,
    );
    await performUiAct(activate("button.commitment-adopt"));
    expect(adoptCommitmentAction).not.toHaveBeenCalled();
    expect(pending[0]?.payload).toMatchObject({
      amount: "2000000",
      heard: "we're thinking two million",
    });
    await act(async () => {
      await approveRequest(pending[0]?.id ?? "");
    });
    expect(adoptCommitmentAction).toHaveBeenCalledTimes(1);
    expect(adoptCommitmentAction.mock.calls[0]?.[0]).toBe(
      "7c000000-0000-4000-8000-000000000001",
    );
  });

  it("recording: nothing to approve until the person has entered it; 'invested' is only their own choice", async () => {
    render(
      <RelationshipCommitment
        relationshipId={RELATIONSHIP}
        counterpart="Ledgerfold"
        initial={dto({})}
      />,
    );
    // The form is closed: Q may open it (NONE), but there is nothing to record.
    const early = activate("button.commitment-record");
    await performUiAct(early);
    expect(heldReason(early.actId)).not.toBe("AWAITING_APPROVAL");
    expect(pending).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Record a commitment" }),
    );
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "500000" },
    });
    // The person themself says the money moved.
    fireEvent.click(screen.getByRole("radio", { name: "Invested" }));
    await performUiAct(activate("button.commitment-record"));
    expect(stateCommitmentAction).not.toHaveBeenCalled();
    expect(pending[0]?.payload).toMatchObject({
      amount: "500000",
      level: "Invested: you confirm the money has moved",
    });
    await act(async () => {
      await approveRequest(pending[0]?.id ?? "");
    });
    expect(stateCommitmentAction).toHaveBeenCalledTimes(1);
    expect(stateCommitmentAction.mock.calls[0]?.[1]).toMatchObject({
      amount: "500000",
      level: "INVESTED",
    });
  });
});
