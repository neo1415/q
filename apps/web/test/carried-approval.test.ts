import { describe, expect, it } from "vitest";

import { carriedApproval } from "../src/features/q/carried-approval";

/**
 * QA 2026-10-01: the approval card disappeared from /home?c= after a reload.
 * A change still waiting in this conversation is found again from the
 * server's pending approvals and the proposal its run recorded -- until the
 * conversation moves on (founder, voiceq-63), when the card leaves the
 * screen and stays listed under Needs you on Work.
 */
const proposal = {
  proposalId: "p1",
  runId: "run-1",
  summary: "Reminder: Send Savanna the updated deck",
} as never;
const history = [
  {
    messageId: "m1",
    runId: "run-1",
    role: "Q",
    text: "Prepared.",
    createdAt: "2026-10-01T11:50:34Z",
    blocks: [{ kind: "ACTION_PROPOSAL", proposal }],
  },
  {
    messageId: "m2",
    runId: "run-2",
    role: "Q",
    text: "Something else.",
    createdAt: "2026-10-01T11:51:20Z",
  },
] as never;
const pending = (conversationId: string, runId = "run-1") =>
  [
    {
      approvalId: "a1",
      runId,
      conversationId,
      summary: "Reminder: Send Savanna the updated deck",
      requestedAt: "2026-10-01T11:50:34Z",
      expiresAt: "2026-10-02T11:50:34Z",
    },
  ] as never;

describe("a change still waiting in this conversation", () => {
  const before = [history[0]] as never;
  const reminded = [
    history[0],
    {
      messageId: "m2",
      runId: "run-2",
      role: "Q",
      text: "Still waiting for your approval: Reminder: Send Savanna the updated deck.",
      createdAt: "2026-10-01T11:51:20Z",
    },
  ] as never;

  it("keeps its card after a reload, until the conversation moves on", () => {
    expect(carriedApproval("c1", before, pending("c1"))).toMatchObject({
      approval: { approvalId: "a1", proposalId: "p1" },
      runId: "run-1",
    });
    // A later turn that is about the card keeps it in front of them.
    expect(carriedApproval("c1", reminded, pending("c1"))).not.toBeNull();
  });

  it("leaves the screen once Q has answered something else (founder, voiceq-63)", () => {
    // Still waiting on the server and under Needs you on Work; only the
    // card in the conversation goes.
    expect(carriedApproval("c1", history, pending("c1"))).toBeNull();
  });

  it("is not shown in another conversation, or without its recorded proposal", () => {
    expect(carriedApproval("c1", before, pending("c2"))).toBeNull();
    expect(carriedApproval("c1", before, pending("c1", "run-9"))).toBeNull();
    expect(carriedApproval(null, before, pending("c1"))).toBeNull();
  });
});
