import { describe, expect, it } from "vitest";

import {
  carriedApproval,
  shownCardsKey,
} from "../src/features/q/carried-approval";

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
  approval: {
    required: true,
    approval: { approvalId: "a1", status: "PENDING" },
  },
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
    expect(carriedApproval("c1", before, [])).toBeNull();
    expect(carriedApproval(null, before, pending("c1"))).toBeNull();
  });
});

/**
 * F-106 (batch 9, founder.maji-loop, conversation 09c366b5…): "Draft a short
 * reply to Savanna Seed… then send it" was answered "That's ready: Message
 * Savanna Seed Partners. It's waiting for your yes." with the card an
 * earlier run (in another conversation) had made, and no Approve button
 * appeared, not even after a reload. An answer that shows a waiting card
 * puts that card in front of the person, whichever run made it.
 */
describe("a waiting card shown again by a later answer (F-106)", () => {
  const savanna = {
    proposalId: "p-savanna",
    runId: "run-old",
    summary: "Message Savanna Seed Partners (fictional)",
    approval: {
      required: true,
      approval: { approvalId: "a-savanna", status: "PENDING" },
    },
  } as never;
  const waiting = [
    {
      approvalId: "a-savanna",
      runId: "run-old",
      conversationId: "c-earlier",
      summary: "Message Savanna Seed Partners (fictional)",
      requestedAt: "2026-10-24T14:56:55Z",
      expiresAt: "2026-10-25T14:56:55Z",
    },
    {
      approvalId: "a-other",
      runId: "run-older",
      conversationId: "c-now",
      summary: "Update your mandate",
      requestedAt: "2026-10-24T07:51:00Z",
      expiresAt: "2026-10-25T07:51:00Z",
    },
  ] as never;
  const ready = {
    messageId: "m-ready",
    runId: "run-new",
    role: "Q",
    text: "That's ready: Message Savanna Seed Partners (fictional). It's waiting for your yes.",
    createdAt: "2026-10-24T21:54:55Z",
    blocks: [{ kind: "ACTION_PROPOSAL", proposal: savanna }],
  };
  const earlier = {
    messageId: "m-fit",
    runId: "run-fit",
    role: "Q",
    text: "On Capital Q, Zino Aviation, Alchemist Doha are a likely fit.",
    createdAt: "2026-10-24T21:54:43Z",
  };

  it("shows the card that answer named, with its approval", () => {
    expect(
      carriedApproval("c-now", [earlier, ready] as never, waiting),
    ).toMatchObject({
      approval: { approvalId: "a-savanna", proposalId: "p-savanna" },
      proposal: { summary: "Message Savanna Seed Partners (fictional)" },
    });
  });

  it("keeps it after a reload, until the conversation moves on", () => {
    const after = {
      messageId: "m-next",
      runId: "run-next",
      role: "Q",
      text: "Right now, investors who can find Maji Loop can see…",
      createdAt: "2026-10-24T21:55:50Z",
    };
    expect(
      carriedApproval("c-now", [earlier, ready, after] as never, waiting),
    ).toBeNull();
  });

  it("never brings another conversation's card that no answer here showed", () => {
    expect(carriedApproval("c-now", [earlier] as never, waiting)).toBeNull();
  });
});

/**
 * Egress (2026-10-24): the waiting approvals are asked of the server again
 * only when the cards a thread shows change; a thread with no card asks
 * nothing.
 */
describe("the cards a thread shows, as one key", () => {
  const card = (proposalId: string) => ({
    kind: "ACTION_PROPOSAL",
    proposal: { proposalId },
  });
  it("is empty without a card, and the same however often a card is shown", () => {
    expect(shownCardsKey([{ role: "Q", text: "Hi." }] as never)).toBe("");
    const once = shownCardsKey([
      { role: "Q", blocks: [card("p2")] },
      { role: "Q", blocks: [card("p1")] },
    ] as never);
    const again = shownCardsKey([
      { role: "Q", blocks: [card("p1")] },
      { role: "USER", text: "and?" },
      { role: "Q", blocks: [card("p2"), card("p1")] },
    ] as never);
    expect(once).toBe("p1,p2");
    expect(again).toBe(once);
  });
});
