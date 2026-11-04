import { beforeAll, describe, expect, it } from "vitest";

import { createQStreamState } from "@capital-q/api-client";
import { QMessageSchema, type QMessage } from "@capital-q/contracts";

import { turnsFrom } from "../src/features/q/conversation";
import { shownItems, stageOf } from "../src/features/q/shown";
import { loadWire } from "../src/features/q/wire";

beforeAll(async () => {
  await loadWire();
});

/**
 * Live 2026-11-04 (P1/P4, conversation 014faef1 on 06597e7c8): the plan's
 * delivery ("Your plan is ready" with PLAN, CLARIFICATION_REQUEST and the
 * job's WORK_IN_PROGRESS) is stored on the SAME run as the "I'm on it"
 * turn that carries the job's progress card. The Q view's stage took that
 * run's first set -- the progress card -- and never drew the plan, so no
 * plan card and no Execute appeared on the Q view at 1440 or 390.
 */
const RUN = "529e3ae5-6504-4158-af22-5b96f443daa2";
const JOB = "7b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const PLAN = "934b1576-b7c1-489d-b819-344a397f9651";

const messages: QMessage[] = [
  {
    messageId: "349173e0-0000-4000-8000-000000000001",
    runId: RUN,
    role: "USER",
    text: "Make me a plan to check in this week with two founders",
    createdAt: "2026-11-04T17:52:32.735Z",
  },
  {
    messageId: "2a288944-0000-4000-8000-000000000002",
    runId: RUN,
    role: "Q",
    text: "I'm on it: gathering where things stand for you now.",
    createdAt: "2026-11-04T17:52:39.229Z",
    blocks: [{ kind: "WORK_IN_PROGRESS", jobId: JOB, title: "Your plan" }],
  },
  {
    messageId: "750859f8-0000-4000-8000-000000000003",
    runId: RUN,
    role: "Q",
    text: "Your plan is ready: 8 steps.",
    createdAt: "2026-11-04T17:55:19.882Z",
    blocks: [
      {
        kind: "PLAN",
        planId: PLAN,
        version: 1,
        title: "Check in this week with two connected founders",
        steps: 8,
        reviewed: false,
        affordances: ["EXECUTE", "PUT_ON_BOARD", "CHANGE"],
      },
      {
        kind: "CLARIFICATION_REQUEST",
        question: "What would you like to do with your plan?",
        options: [
          "Give me a short summary",
          "Read me the whole plan",
          "Go ahead and run it",
        ],
      },
      { kind: "WORK_IN_PROGRESS", jobId: JOB, title: "Your plan" },
    ],
  },
].map((message) => QMessageSchema.parse(message));

describe("the plan's delivery reaches the Q view's stage (P1/P4)", () => {
  it("the stage draws the plan, not the job's progress card", () => {
    const turns = turnsFrom({ ...createQStreamState(), messages }, []);
    const items = shownItems(turns);
    // One set for the run: the delivery took the progress card's place.
    expect(items).toHaveLength(1);
    const kinds = items[0]?.blocks.map((block) => block.kind);
    expect(kinds).toContain("PLAN");
    expect(kinds).not.toContain("WORK_IN_PROGRESS");
    const pick = stageOf(items, turns);
    expect(pick.item?.blocks.some((block) => block.kind === "PLAN")).toBe(
      true,
    );
  });

  it("a repeat of a run that delivered nothing still never makes a second set", () => {
    const repeat = QMessageSchema.parse({
      messageId: "8a000000-0000-4000-8000-000000000004",
      runId: RUN,
      role: "Q",
      text: "Still working.",
      createdAt: "2026-11-04T17:53:00.000Z",
      blocks: [{ kind: "WORK_IN_PROGRESS", jobId: JOB, title: "Your plan" }],
    });
    const turns = turnsFrom(
      {
        ...createQStreamState(),
        messages: [messages[0], messages[1], repeat].filter(
          (message): message is QMessage => message !== undefined,
        ),
      },
      [],
    );
    const items = shownItems(turns);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("2a288944-0000-4000-8000-000000000002");
  });
});

describe("Now shows no second control for the plan's quiet execute card", () => {
  const proposal = {
    proposalId: "6f000000-0000-4000-8000-000000000009",
    runId: "657d0bc3-ee73-4cad-bc07-9a89785482c6",
    actionType: "q.plan.execute",
    summary: "Run your plan: Check in this week with two connected founders",
  };
  const approval = {
    approvalId: "d710caf2-393b-4492-a5b5-b0bc9e6ee270",
    proposalId: proposal.proposalId,
  };

  it("hides the live approval while the plan card is in the conversation", async () => {
    const { nowApproval } = await import("../src/features/q/q-now");
    const shown = nowApproval({
      approval,
      proposals: [proposal],
      messages,
    } as never);
    expect(shown.approval).toBeNull();
    expect(shown.proposal).toBeUndefined();
  });

  it("keeps it, and every other card, where no plan card stands for it", async () => {
    const { nowApproval } = await import("../src/features/q/q-now");
    const noPlan = messages.slice(0, 2);
    expect(
      nowApproval({ approval, proposals: [proposal], messages: noPlan } as never)
        .approval,
    ).toEqual(approval);
    const send = { ...proposal, actionType: "chat.message.send" };
    expect(
      nowApproval({ approval, proposals: [send], messages } as never).approval,
    ).toEqual(approval);
  });
});
