// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QApprovalViewSchema,
  QPendingApprovalSchema,
  type QApprovalView,
} from "@capital-q/contracts";

const approve = vi.fn<(id: string) => Promise<unknown>>();
const reject = vi.fn<(id: string) => Promise<unknown>>();
const read = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: (id: string) => approve(id),
  rejectQApprovalAction: (id: string) => reject(id),
  readQApprovalAction: (id: string) => read(id),
}));
vi.mock("../src/features/integrations/email-draft-editor", () => ({
  EmailDraftEditor: () => null,
}));

const { ApprovalsPanel } = await import("../src/features/work/approvals-panel");

afterEach(() => {
  cleanup();
  approve.mockReset();
  reject.mockReset();
  read.mockReset();
});

const ID = "00000000-0000-4000-8000-0000000000a1";
const pending = QPendingApprovalSchema.parse({
  approvalId: ID,
  runId: "00000000-0000-4000-8000-0000000000b1",
  conversationId: null,
  summary: "Reply to Savanna Seed Partners",
  requestedAt: "2026-10-03T09:00:00Z",
  expiresAt: "2026-10-04T09:00:00Z",
});

function view(canDecide: boolean): QApprovalView {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId: ID,
    runId: pending.runId,
    status: "PENDING",
    requestedAt: pending.requestedAt,
    expiresAt: pending.expiresAt,
    canDecide,
    action: {
      actionId: "00000000-0000-4000-8000-0000000000c1",
      actionType: "chat.send",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [
        { kind: "COMPANY", companyId: "00000000-0000-4000-8000-0000000000d1" },
      ],
      summary: "Reply to Savanna Seed Partners",
      preview: "Hi Ngozi, the cap table is in the data room.",
    },
  });
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

describe("Needs you on Q's work", () => {
  it("renders nothing when nothing waits", () => {
    const { container } = render(<ApprovalsPanel initial={[]} />);
    expect(container.textContent).toBe("");
  });

  it("says so when the server read failed, and that nothing is sent", () => {
    render(<ApprovalsPanel initial={null} />);
    expect(screen.getByText(/Nothing is sent without your yes/u)).toBeTruthy();
  });

  it("shows the exact text before the yes, then approves that approval", async () => {
    read.mockResolvedValue({ ok: true, value: view(true) });
    approve.mockResolvedValue({ ok: true, value: null });
    render(<ApprovalsPanel initial={[pending]} />);
    expect(screen.getByText("to approve", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    expect(
      screen.getByText("Hi Ngozi, the cap table is in the data room."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
    await settle();
    expect(approve).toHaveBeenCalledWith(ID);
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByText("Approved. Q is doing it now.")).toBeTruthy();
  });

  it("cannot approve one that is no longer open", async () => {
    read.mockResolvedValue({ ok: true, value: view(false) });
    render(<ApprovalsPanel initial={[pending]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    const yes = screen.getByRole("button", { name: "Approve and send" });
    expect((yes as HTMLButtonElement).disabled).toBe(true);
  });

  it("'Not now' decides nothing", async () => {
    read.mockResolvedValue({ ok: true, value: view(true) });
    render(<ApprovalsPanel initial={[pending]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
  });
  it("opens the next one after a decision, so a run is one pass", async () => {
    const second = QPendingApprovalSchema.parse({
      ...pending,
      approvalId: "00000000-0000-4000-8000-0000000000a2",
      summary: "Reply to Voltron Capital",
    });
    read.mockResolvedValue({ ok: true, value: view(true) });
    reject.mockResolvedValue({ ok: true, value: null });
    render(<ApprovalsPanel initial={[pending, second]} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await settle();
    expect(screen.getByText(/^1 of 2/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await settle();
    expect(reject).toHaveBeenCalledWith(ID);
    expect(screen.getByText(/^1 of 1/u)).toBeTruthy();
    expect(screen.getByText("Declined. Nothing was sent.")).toBeTruthy();
  });
});
