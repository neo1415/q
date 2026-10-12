import { describe, expect, it, vi } from "vitest";
import { QApprovalViewSchema } from "@capital-q/contracts";
import { createListPendingApprovalsTool } from "../src/tools/own-work.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

const approvalId = "e0000000-0000-4000-8000-000000000001";
const view = QApprovalViewSchema.parse({
  contractVersion: 1,
  approvalId,
  runId: "e0000000-0000-4000-8000-000000000002",
  status: "PENDING",
  requestedAt: "2026-10-12T00:00:00Z",
  expiresAt: "2026-10-13T00:00:00Z",
  canDecide: true,
  action: {
    actionId: "e0000000-0000-4000-8000-000000000003",
    actionType: "app.diligence.questions.send",
    actionVersion: 1,
    actionClass: "CONFIRM_REQUIRED",
    actionStatus: "AWAITING_APPROVAL",
    targets: [
      { kind: "COMPANY", companyId: "e0000000-0000-4000-8000-000000000004" },
    ],
    summary: "Send founder diligence questions",
    preview:
      "1. What validates the retention claim?\n2. What are the signed contract terms?",
  },
});
const plan = planFor(actorA, "GENERAL_QUESTION", [
  { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
]);

describe("exact owned approval read", () => {
  it("keeps the default list cheap and reads only an explicitly requested card", async () => {
    const pending = vi.fn(() => Promise.resolve([]));
    const read = vi.fn(() => Promise.resolve(view));
    const tool = createListPendingApprovalsTool({ pending, read });
    expect(await tool.execute({}, contextFor(actorA, plan), null)).toEqual({
      items: [],
    });
    expect(read).not.toHaveBeenCalled();
    const input = tool.input.parse({ approvalId });
    const out = await tool.execute(input, contextFor(actorA, plan), null);
    expect(out).toMatchObject({ items: [], detail: view });
    expect(read).toHaveBeenCalledWith(actorA, approvalId);
    expect(pending).toHaveBeenCalledOnce();
    expect(view.action.actionStatus).toBe("AWAITING_APPROVAL");
    expect(view.status).toBe("PENDING");
  });
  it("returns no card when ownership or a revoked grant is refused", async () => {
    const tool = createListPendingApprovalsTool({
      pending: () => Promise.resolve([]),
      read: () => Promise.reject(new Error("NOT_FOUND")),
    });
    expect(
      await tool.execute(
        tool.input.parse({ approvalId }),
        contextFor(actorA, plan),
        null,
      ),
    ).toEqual({ items: [], detail: null });
  });
  it("rejects a different person's own-conversation scope before reading", async () => {
    const read = vi.fn(() => Promise.resolve(view));
    const tool = createListPendingApprovalsTool({
      pending: () => Promise.resolve([]),
      read,
    });
    const otherPlan = {
      ...plan,
      scopes: plan.scopes.map((scope) => ({
        ...scope,
        filter: { ...scope.filter, userId: actorB.userId },
      })),
    };
    expect(
      await tool.authorize(
        tool.input.parse({ approvalId }),
        contextFor(actorA, otherPlan),
      ),
    ).toMatchObject({ outcome: "DENY" });
    expect(read).not.toHaveBeenCalled();
  });
});
