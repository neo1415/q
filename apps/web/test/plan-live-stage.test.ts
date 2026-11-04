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
    expect(pick.item?.blocks.some((block) => block.kind === "PLAN")).toBe(true);
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
      nowApproval({
        approval,
        proposals: [proposal],
        messages: noPlan,
      } as never).approval,
    ).toEqual(approval);
    const send = { ...proposal, actionType: "chat.message.send" };
    expect(
      nowApproval({ approval, proposals: [send], messages } as never).approval,
    ).toEqual(approval);
  });
});

describe("N2: a running plan's steps are in the work list", () => {
  const step = (key: string, title: string, status: string) => ({
    key,
    title,
    status,
    proposalId: status === "PROPOSED" ? UUID_A : null,
    boardItemId: status === "WAITING_YOU" ? UUID_A : null,
  });
  const UUID_A = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
  const view = (status: string) =>
    ({
      current: true,
      status,
      plan: {
        planId: PLAN,
        goal: "Check in this week with two connected founders",
        steps: [
          step("s1", "Prepare the connected-founder shortlist.", "DONE"),
          step("s2", "Draft tailored check-in messages", "DOING"),
          step("s3", "Prepare a meeting proposal for Maji Loop", "PROPOSED"),
          step("s4", "Choose the two founders", "WAITING_YOU"),
        ],
      },
    }) as never;

  it("lists every step with where it stands while the plan runs", async () => {
    const { planStream } = await import("../src/features/q/work-progress");
    const { stepStatusWords } = await import("../src/features/q/plan-card");
    const stream = planStream(view("EXECUTING"), (one) =>
      stepStatusWords(one, true),
    );
    expect(stream?.source).toBe("PLAN");
    expect(stream?.status).toBe("WORKING");
    expect(
      stream?.steps.map((one) => [one.label, one.state, one.note]),
    ).toEqual([
      ["Prepare the connected-founder shortlist", "DONE", undefined],
      ["Draft tailored check-in messages", "CURRENT", undefined],
      [
        "Prepare a meeting proposal for Maji Loop",
        "WAITING",
        "Ready for your approval",
      ],
      ["Choose the two founders", "WAITING", "Your part, on your board"],
    ]);
  });

  it("nothing for a plan that is not running", async () => {
    const { planStream } = await import("../src/features/q/work-progress");
    expect(planStream(view("OFFERED"), () => null)).toBeNull();
  });

  it("the newest plan in the conversation is the one followed", async () => {
    const { latestPlanOf } = await import("../src/features/q/running-plan");
    const turns = turnsFrom({ ...createQStreamState(), messages }, []);
    expect(latestPlanOf(turns)).toEqual({ planId: PLAN, version: 1 });
    expect(latestPlanOf(turns.slice(0, 2))).toBeNull();
  });
});

describe("Now shows no second 'Q asks' for the plan's own offer (J4)", () => {
  it("the plan turn's offer stays with the plan card", async () => {
    const { nowQuestions } = await import("../src/features/q/q-now");
    const turns = turnsFrom({ ...createQStreamState(), messages }, []);
    expect(nowQuestions(turns)).toEqual([]);
  });

  it("a question in a turn without a plan still shows", async () => {
    const { nowQuestions } = await import("../src/features/q/q-now");
    const asking = QMessageSchema.parse({
      messageId: "9b000000-0000-4000-8000-000000000005",
      runId: RUN,
      role: "Q",
      text: "Which fund is this for?",
      createdAt: "2026-11-04T17:56:00.000Z",
      blocks: [
        {
          kind: "CLARIFICATION_REQUEST",
          question: "Which fund is this for?",
          options: ["Fund I", "Fund II"],
        },
      ],
    });
    const turns = turnsFrom(
      {
        ...createQStreamState(),
        messages: [messages[0], asking].filter(
          (message): message is QMessage => message !== undefined,
        ),
      },
      [],
    );
    expect(nowQuestions(turns).map((q) => q.question)).toEqual([
      "Which fund is this for?",
    ]);
  });
});
