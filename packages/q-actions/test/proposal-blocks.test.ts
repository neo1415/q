import { describe, expect, it } from "vitest";

import { proposalBlocks } from "../src/application/narrator.js";

/**
 * QA 2026-10-01: a reminder proposed in a turn whose answer structure was
 * refused left no ACTION_PROPOSAL in the conversation, so a typed "go
 * ahead" and the card after a reload could not find it. The "Not saved
 * yet" line now carries the proposal.
 */
const action = {
  id: "7e09ef10-e6b2-4004-9227-580fe19b7a9c",
  runId: "687cdf89-6fcc-4f5a-988a-2dd336a7688e",
  actionType: "reminder.create",
  riskClass: "CONFIRM_REQUIRED",
  targets: [{ kind: "USER", userId: "56e3adff-bc0d-42aa-a161-e1fa522a901b" }],
  summary: "Reminder: Review the term sheet",
  preview: null,
  createdAt: "2026-10-01T12:43:40.890Z",
} as never;

describe("the waiting line carries its proposal", () => {
  it("as an ACTION_PROPOSAL block bound to the approval", () => {
    const blocks = proposalBlocks(action, {
      id: "c888abda-52aa-49ba-92df-80886d7831ff",
      expiresAt: "2026-10-02T12:43:40.890Z",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({
      kind: "ACTION_PROPOSAL",
      proposal: {
        proposalId: "7e09ef10-e6b2-4004-9227-580fe19b7a9c",
        summary: "Reminder: Review the term sheet",
        approval: {
          approval: { approvalId: "c888abda-52aa-49ba-92df-80886d7831ff" },
        },
      },
    });
  });

  it("not at all without the approval it is bound to", () => {
    expect(proposalBlocks(action, undefined)).toBeUndefined();
  });
});
