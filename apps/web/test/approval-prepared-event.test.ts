// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  announceApprovalDecided,
  announceApprovalPrepared,
  Q_APPROVAL_DECIDED_EVENT,
  Q_APPROVAL_PREPARED_EVENT,
} from "../src/features/q/approval-decided";

// Live 2026-10-29: Execute on a plan card prepared its approval card as a
// new message, which showed only after a reload. The plan card announces it
// and the conversation reads its thread again.
describe("approval events between cards and the conversation", () => {
  it("announces a prepared approval, distinct from a decided one", () => {
    const prepared = vi.fn();
    const decided = vi.fn();
    window.addEventListener(Q_APPROVAL_PREPARED_EVENT, prepared);
    window.addEventListener(Q_APPROVAL_DECIDED_EVENT, decided);
    announceApprovalPrepared();
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(decided).not.toHaveBeenCalled();
    announceApprovalDecided();
    expect(decided).toHaveBeenCalledTimes(1);
    window.removeEventListener(Q_APPROVAL_PREPARED_EVENT, prepared);
    window.removeEventListener(Q_APPROVAL_DECIDED_EVENT, decided);
  });
});
