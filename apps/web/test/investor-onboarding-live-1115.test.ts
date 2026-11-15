import { describe, expect, it } from "vitest";

import {
  FINISH_REVIEW_STEP,
  finishSummary,
  questionHeadingSize,
} from "../src/features/onboarding-conversation/conversation";
import { restorePendingApproval } from "../src/features/q/carried-approval";
import type { QMessage, QPendingApproval } from "@capital-q/contracts";

/**
 * Live investor onboarding, 15 Nov 2026
 * (docs/ai-handoff/audits/2026-11-15-investor-onboarding-live.md).
 */
describe("D2: Finish shows a compact summary and finishes with one tap", () => {
  it("one line a group, known values only, the rest counted", () => {
    const item = (stepKey: string, value: string | null) => ({
      stepKey,
      title: stepKey,
      value,
      editorId: undefined,
    });
    const lines = finishSummary([
      {
        label: "Stage and cheque",
        items: [
          item("I2.stages", "Pre-seed, Seed"),
          item("I2.currency", "US dollar"),
          item("I2.cheque_min", "$100,000"),
          item("I2.cheque_typical", "$250,000"),
          item("I2.cheque_max", "$500,000"),
        ],
      },
      { label: "Portfolio", items: [item("I8.portfolio", null)] },
      {
        label: "Geography and sectors",
        items: [item("I3.geography", "East Africa")],
      },
    ]);
    expect(lines).toEqual([
      {
        label: "Stage and cheque",
        text: "Pre-seed, Seed · US dollar · $100,000 +2",
      },
      { label: "Geography and sectors", text: "East Africa" },
    ]);
  });

  it("the tap confirms the journey's last record review, which finishes", () => {
    expect(FINISH_REVIEW_STEP.investor).toBe("I11.review");
    expect(FINISH_REVIEW_STEP.founder).toBe("F8.snapshot");
  });
});

describe("D6: a reload of /home rebuilds the waiting approval card", () => {
  const proposal = {
    proposalId: "p1",
    runId: "run-1",
    summary: "Update your mandate",
    approval: {
      required: true,
      approval: { approvalId: "a1", status: "PENDING" },
    },
  };
  const history: readonly QMessage[] = [
    {
      messageId: "m1",
      runId: "run-1",
      role: "Q",
      text: "Update your mandate. Not saved yet: tap Approve on the card.",
      createdAt: "2026-11-15T16:03:22Z",
      blocks: [{ kind: "ACTION_PROPOSAL", proposal }],
    },
  ] as never;
  const pending: readonly QPendingApproval[] = [
    {
      approvalId: "a1",
      runId: "run-1",
      conversationId: "c-old",
      summary: "Update your mandate",
      requestedAt: "2026-11-15T16:03:22.000Z",
      expiresAt: "2026-11-16T16:03:22.000Z",
    },
  ] as never;

  it("finds the card in the conversation that recorded it", async () => {
    const read: string[] = [];
    const found = await restorePendingApproval(pending, (id) => {
      read.push(id);
      return Promise.resolve(id === "c-old" ? history : null);
    });
    expect(read).toEqual(["c-old"]);
    expect(found).toMatchObject({
      approval: { approvalId: "a1", proposalId: "p1" },
      runId: "run-1",
    });
  });

  it("no recorded proposal, no card", async () => {
    expect(
      await restorePendingApproval(pending, () => Promise.resolve([])),
    ).toBeNull();
    expect(
      await restorePendingApproval([], () => Promise.resolve(history)),
    ).toBeNull();
  });
});

describe("D7: a long line of Q's is a smaller heading at 390", () => {
  it("reads long lines small", () => {
    expect(
      questionHeadingSize(
        "That gives me the core shape: an angel syndicate, actively deploying US$50,000–$150,000 at pre-seed in fintech across East Africa. What draws you specifically to fintech in East Africa?",
      ),
    ).toBe("sm");
    expect(questionHeadingSize("What's your firm's website?")).toBe("lg");
  });
});
