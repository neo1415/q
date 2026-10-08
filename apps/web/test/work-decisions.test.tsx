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
  QWorkDoneItemDtoSchema,
  WorkforceJobDetailDtoSchema,
  type QWorkDoneItemDto,
  type WorkforceJobDetailDto,
} from "@capital-q/contracts";

const approve = vi.fn<(id: string) => Promise<unknown>>();
const reject = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: (id: string) => approve(id),
  rejectQApprovalAction: (id: string) => reject(id),
}));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));
const send =
  vi.fn<(id: string, message: unknown, key: string) => Promise<unknown>>();
const thread = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/chat/chat-actions", () => ({
  chatThreadAction: (id: string) => thread(id),
  sendChatMessageAction: (id: string, message: unknown, key: string) =>
    send(id, message, key),
}));
const sendAsIs = vi.fn<(input: unknown) => Promise<unknown>>();
const retryHeld = vi.fn<(input: unknown) => Promise<unknown>>();
vi.mock("../src/features/work/held-actions", () => ({
  sendHeldAsIsAction: (input: unknown) => sendAsIs(input),
  retryHeldAction: (input: unknown) => retryHeld(input),
}));
const listDone = vi.fn<(cursor: string) => Promise<unknown>>();
vi.mock("../src/features/work/work-page-actions", () => ({
  listDoneAction: (cursor: string) => listDone(cursor),
}));

const {
  decisionGroups,
  decisionTitle,
  doneGroups,
  heldDecisions,
  isChatSend,
  threadLines,
  withPage,
} = await import("../src/features/work/decisions");
const { DecisionQueue, DoneForYou } =
  await import("../src/features/work/decision-queue");

afterEach(() => {
  cleanup();
  for (const mock of [
    approve,
    reject,
    send,
    thread,
    listDone,
    sendAsIs,
    retryHeld,
  ])
    mock.mockReset();
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REL_T = id(901);
const REL_L = id(902);
const NOW = Date.parse("2026-10-08T10:00:00Z");

// The Tensorgate thread on staging, 2026-10-07 (seeded founders).
const THEIRS =
  "Thanks for connecting. Tensorgate is a policy gateway for LLM traffic in regulated industries. Raising a $4m seed. Want the deck, or 20 minutes this week? Daniel";
const DRAFT_1 =
  "Hello Tensorgate team — running LLM inference inside hardware enclaves stood out. Would you be open to connecting?";
const DRAFT_2 =
  "Hi Daniel, 20 minutes this week works well, and please send the deck ahead. Which time suits you?";

function grade(score: number, passed: boolean, feedback = "") {
  return {
    score,
    passed,
    threshold: 75,
    maxRedrafts: 1,
    rubricVersion: "workforce-rubric/v1",
    criteria: [],
    integrity: [],
    feedback,
  };
}

function job(
  drafts: readonly {
    readonly n: number;
    readonly parent: number | null;
    readonly name: string;
    readonly body: string;
    readonly at: string;
    readonly grade: ReturnType<typeof grade> | null;
    readonly outcome: null | {
      readonly outcome: "SENT" | "OFFERED" | "HELD";
      readonly reason?: string;
      readonly approvalId?: string;
    };
  }[],
  source: "INSTRUCTION" | "JOB" = "INSTRUCTION",
): WorkforceJobDetailDto {
  return WorkforceJobDetailDtoSchema.parse({
    job: {
      id: id(700 + drafts.length),
      goal: "Reply to founders who accept or write to me",
      source,
      status: "RUNNING",
      reviewBar: {
        threshold: 75,
        maxRedrafts: 1,
        rubricVersion: "workforce-rubric/v1",
      },
      budgetUsd: "0.5",
      costUsd: "0.01",
      agents: 3,
      drafts: drafts.length,
      held: 0,
      createdAt: "2026-10-07T15:42:53Z",
      updatedAt: "2026-10-07T15:43:31Z",
    },
    agents: [],
    drafts: drafts.map((one) => ({
      id: id(one.n),
      attempt: one.parent === null ? 1 : 2,
      parentDraftId: one.parent === null ? null : id(one.parent),
      channel: "CHAT",
      counterpartName: one.name,
      body: one.body,
      grade: one.grade,
      outcome:
        one.outcome === null
          ? null
          : {
              outcome: one.outcome.outcome,
              reason: one.outcome.reason ?? null,
              qActionId: null,
              approvalId: one.outcome.approvalId ?? null,
              approvalStatus:
                one.outcome.approvalId === undefined ? null : "PENDING",
            },
      feedback: [],
      createdAt: one.at,
    })),
    timeline: [],
  });
}

const APPROVAL_T = id(501);
const APPROVAL_T2 = id(503);
const APPROVAL_L = id(502);

const tensorgateJob = job([
  {
    n: 1,
    parent: null,
    name: "Tensorgate",
    body: DRAFT_1,
    at: "2026-10-07T15:43:09Z",
    grade: grade(84, false, "1. They already offered or asked for a call."),
    outcome: null,
  },
  {
    n: 2,
    parent: 1,
    name: "Tensorgate",
    body: DRAFT_2,
    at: "2026-10-07T15:43:17Z",
    grade: grade(86, true),
    outcome: { outcome: "OFFERED", approvalId: APPROVAL_T },
  },
  {
    n: 3,
    parent: null,
    name: "Spheros",
    body: "Hello Spheros team",
    at: "2026-10-07T15:43:16Z",
    grade: null,
    outcome: { outcome: "HELD", reason: "REVIEW_UNAVAILABLE" },
  },
]);

function pending(approvalId: string, at: string, summary: string) {
  return QPendingApprovalSchema.parse({
    approvalId,
    runId: id(600),
    conversationId: null,
    summary,
    requestedAt: at,
    expiresAt: "2026-10-09T09:00:00Z",
  });
}

function chatView(approvalId: string, relationshipId: string, preview: string) {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId,
    runId: id(600),
    status: "PENDING",
    requestedAt: "2026-10-07T15:43:31Z",
    expiresAt: "2026-10-09T09:00:00Z",
    canDecide: true,
    action: {
      actionId: id(800),
      actionType: "chat.message.send",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [{ kind: "RELATIONSHIP", relationshipId }],
      summary: "Send a message",
      preview,
    },
  });
}

function doneItem(
  n: number,
  at: string,
  words: string,
  relationshipId: string | null,
  counterpartName: string | null,
): QWorkDoneItemDto {
  return QWorkDoneItemDtoSchema.parse({
    id: id(n),
    words,
    at,
    linkPath:
      relationshipId === null ? null : `/relationships/company/${id(n + 50)}`,
    relationshipId,
    counterpartName,
  });
}

describe("the decision queue's grouping", () => {
  it("puts one card per decision under its company, newest group first, with the drafts inside", () => {
    const views = new Map([
      [APPROVAL_T, chatView(APPROVAL_T, REL_T, DRAFT_2)],
      [APPROVAL_T2, chatView(APPROVAL_T2, REL_T, "A second note")],
      [APPROVAL_L, chatView(APPROVAL_L, REL_L, "Hi Tobenna")],
    ]);
    const groups = decisionGroups({
      approvals: [
        pending(APPROVAL_L, "2026-10-07T15:40:00Z", "Message Ledgerline"),
        pending(APPROVAL_T, "2026-10-07T15:43:31Z", "Message Tensorgate"),
        pending(APPROVAL_T2, "2026-10-07T15:44:00Z", "Message Tensorgate"),
      ],
      views,
      jobs: [tensorgateJob],
      now: NOW,
    });
    // Tensorgate (two cards) first, then Ledgerline, then the held Spheros.
    expect(groups.map((group) => group.relationshipId ?? group.name)).toEqual([
      REL_T,
      "Spheros",
      REL_L,
    ]);
    const tensorgate = groups[0];
    expect(tensorgate?.name).toBe("Tensorgate");
    expect(tensorgate?.items.map((item) => item.at)).toEqual([
      "2026-10-07T15:44:00Z",
      "2026-10-07T15:43:31Z",
    ]);
    const card = tensorgate?.items[1];
    expect(
      card?.kind === "APPROVAL" ? card.drafts.map((d) => d.attempt) : [],
    ).toEqual([1, 2]);
    // Writer and reviewer drafts are never top-level rows.
    expect(groups.flatMap((group) => group.items)).toHaveLength(4);
  });

  it("keeps a held draft as a decision until a later message to them supersedes it, for a week", () => {
    expect(heldDecisions([tensorgateJob], NOW).map((one) => one.name)).toEqual([
      "Spheros",
    ]);
    expect(heldDecisions([tensorgateJob], NOW, new Set([id(3)]))).toHaveLength(
      0,
    );
    expect(
      heldDecisions([tensorgateJob], Date.parse("2026-10-20T00:00:00Z")),
    ).toHaveLength(0);
    const later = job([
      {
        n: 3,
        parent: null,
        name: "Spheros",
        body: "Held",
        at: "2026-10-07T15:43:16Z",
        grade: null,
        outcome: { outcome: "HELD", reason: "BELOW_BAR" },
      },
      {
        n: 9,
        parent: null,
        name: "Spheros",
        body: "Sent later",
        at: "2026-10-07T18:00:00Z",
        grade: grade(90, true),
        outcome: { outcome: "SENT" },
      },
    ]);
    expect(heldDecisions([later], NOW)).toHaveLength(0);
  });
});

describe("Done for you", () => {
  it("groups per relationship, newest first, and merges a further page once each", () => {
    const first = [
      doneItem(
        11,
        "2026-10-07T15:43:31Z",
        "Replied to Clearwater",
        id(903),
        "Clearwater Assurance",
      ),
      doneItem(
        12,
        "2026-10-07T15:43:31Z",
        "Replied to Shiftwell",
        id(904),
        "Shiftwell",
      ),
      doneItem(
        13,
        "2026-10-06T08:00:00Z",
        "Expressed interest",
        id(903),
        "Clearwater Assurance",
      ),
    ];
    const groups = doneGroups(first);
    expect(groups.map((group) => group.name)).toEqual([
      "Clearwater Assurance",
      "Shiftwell",
    ]);
    expect(groups[0]?.items.map((item) => item.words)).toEqual([
      "Replied to Clearwater",
      "Expressed interest",
    ]);
    const page = [
      doneItem(
        13,
        "2026-10-06T08:00:00Z",
        "Expressed interest",
        id(903),
        "Clearwater Assurance",
      ),
      doneItem(
        14,
        "2026-10-05T08:00:00Z",
        "Expressed interest",
        id(904),
        "Shiftwell",
      ),
    ];
    const merged = withPage(first, page);
    expect(merged.map((item) => item.id)).toEqual([
      id(11),
      id(12),
      id(13),
      id(14),
    ]);
    expect(doneGroups(merged)[1]?.items).toHaveLength(2);
  });

  it("reads the next page by the server's cursor, never an offset", async () => {
    listDone.mockResolvedValue({
      ok: true,
      value: {
        items: [
          doneItem(
            21,
            "2026-10-01T08:00:00Z",
            "Expressed interest",
            id(905),
            "Maji Loop",
          ),
        ],
        thisWeek: 3,
        nextCursor: null,
      },
    });
    render(
      <DoneForYou
        now={NOW}
        initial={{
          items: [
            doneItem(
              20,
              "2026-10-07T08:00:00Z",
              "Replied",
              id(906),
              "Nsuo Labs",
            ),
          ],
          thisWeek: 3,
          nextCursor: "MjAyNi0xMC0wN3x4",
        }}
        jobs={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show more/u }));
    await settle();
    expect(listDone).toHaveBeenCalledWith("MjAyNi0xMC0wN3x4");
    expect(screen.getByText("Maji Loop")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show more/u })).toBeNull();
  });
});

describe("a decision card", () => {
  const groups = () =>
    decisionGroups({
      approvals: [
        pending(APPROVAL_T, "2026-10-07T15:43:31Z", "Message Tensorgate"),
      ],
      views: new Map([[APPROVAL_T, chatView(APPROVAL_T, REL_T, DRAFT_2)]]),
      jobs: [tensorgateJob],
      now: NOW,
    }).filter((group) => group.relationshipId === REL_T);

  function show(onDecided = vi.fn()) {
    thread.mockResolvedValue({
      ok: true,
      value: {
        relationshipId: REL_T,
        status: "OPEN",
        messages: [
          {
            messageId: id(301),
            side: "COMPANY",
            mine: false,
            senderName: "Daniel",
            kind: "TEXT",
            body: THEIRS,
            attachment: null,
            voiceDurationMs: null,
            edited: false,
            unsent: false,
            viaQ: false,
            sentAt: "2026-10-06T17:28:35Z",
          },
        ],
      },
    });
    render(
      <DecisionQueue
        groups={groups()}
        jobs={[tensorgateJob]}
        done={[]}
        renderPlan={() => null}
        onDecided={onDecided}
      />,
    );
    return onDecided;
  }

  it("shows what they said, the exact message, and the drafts in one disclosure", async () => {
    show();
    await settle();
    expect(
      screen.getByText(/Want the deck, or 20 minutes this week\?/u),
    ).toBeTruthy();
    expect(screen.getByText(DRAFT_2)).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "How Q wrote this (2 drafts)",
    });
    expect(screen.queryByText(DRAFT_1)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(DRAFT_1)).toBeTruthy();
    expect(
      screen.getByText(/sent back, 8\.4 against a bar of 7\.5/u),
    ).toBeTruthy();
    expect(
      screen.getByText(/They already offered or asked for a call/u),
    ).toBeTruthy();
  });

  it("Approve & send approves that exact card", async () => {
    approve.mockResolvedValue({ ok: true, value: null });
    const onDecided = show();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
    await settle();
    expect(approve).toHaveBeenCalledWith(APPROVAL_T);
    expect(onDecided).toHaveBeenCalledWith(APPROVAL_T);
  });

  it("Edit & send sends their own words as them and declines Q's card", async () => {
    send.mockResolvedValue({ ok: true, value: {} });
    reject.mockResolvedValue({ ok: true, value: null });
    const onDecided = show();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Edit & send" }));
    const box = screen.getByLabelText("Your message");
    fireEvent.change(box, {
      target: { value: "Hi Daniel, Thursday works. Zino" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send as you" }));
    await settle();
    expect(send).toHaveBeenCalledWith(
      REL_T,
      { kind: "TEXT", body: "Hi Daniel, Thursday works. Zino" },
      expect.stringMatching(/^work-edit-/u),
    );
    expect(approve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledWith(APPROVAL_T);
    expect(onDecided).toHaveBeenCalledWith(APPROVAL_T);
  });

  it("Dismiss declines the card", async () => {
    reject.mockResolvedValue({ ok: true, value: null });
    show();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settle();
    expect(reject).toHaveBeenCalledWith(APPROVAL_T);
  });
});

describe("a held card (Zino, 2026-10-08: 'I have no way to approve it')", () => {
  const REL_S = id(77);
  function show(onDecided = vi.fn()) {
    thread.mockResolvedValue({ ok: false });
    const held = decisionGroups({
      approvals: [],
      views: new Map(),
      jobs: [tensorgateJob],
      now: NOW,
    })
      .filter((group) => group.name === "Spheros")
      .map((group) => ({ ...group, relationshipId: REL_S }));
    render(
      <DecisionQueue
        groups={held}
        jobs={[tensorgateJob]}
        done={[]}
        renderPlan={() => null}
        onDecided={onDecided}
      />,
    );
    return onDecided;
  }

  it("offers Send as is, Edit & send, Ask Q to try again, Dismiss and Later", async () => {
    show();
    await settle();
    for (const name of [
      "Send as is",
      "Edit & send",
      "Ask Q to try again",
      "Dismiss",
      "Later",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("Send as is asks 'Send this exact message?' and sends exactly that text", async () => {
    sendAsIs.mockResolvedValue({ ok: true, message: "Sent." });
    const onDecided = show();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Send as is" }));
    expect(sendAsIs).not.toHaveBeenCalled();
    expect(
      screen.getByText("Send this exact message to Spheros?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, send this" }));
    await settle();
    expect(sendAsIs).toHaveBeenCalledTimes(1);
    expect(sendAsIs.mock.calls[0]?.[0]).toMatchObject({
      relationshipId: REL_S,
      body: "Hello Spheros team",
    });
    expect(JSON.stringify(sendAsIs.mock.calls[0]?.[0])).toMatch(
      /"idempotencyKey":"held-/u,
    );
    expect(onDecided).toHaveBeenCalledWith(id(3));
  });

  it("Ask Q to try again re-runs the writer and reviewer for that draft", async () => {
    retryHeld.mockResolvedValue({
      ok: true,
      offered: true,
      message: "Q wrote it again and the reviewer passed it.",
    });
    const onDecided = show();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ask Q to try again" }));
    await settle();
    expect(retryHeld).toHaveBeenCalledTimes(1);
    expect(retryHeld.mock.calls[0]?.[0]).toMatchObject({
      draftId: id(3),
      relationshipId: REL_S,
    });
    expect(JSON.stringify(retryHeld.mock.calls[0]?.[0])).toMatch(
      /"idempotencyKey":"retry-/u,
    );
    expect(onDecided).toHaveBeenCalledWith(id(3));
  });
});

describe("the thread view", () => {
  it("marks what Q sent for them, with why and the drafts behind it", () => {
    const sent = job([
      {
        n: 1,
        parent: null,
        name: "Tensorgate",
        body: DRAFT_1,
        at: "2026-10-07T15:43:09Z",
        grade: grade(60, false, "1. Answer their offer."),
        outcome: null,
      },
      {
        n: 2,
        parent: 1,
        name: "Tensorgate",
        body: DRAFT_2,
        at: "2026-10-07T15:43:23Z",
        grade: grade(84, true),
        outcome: { outcome: "SENT" },
      },
    ]);
    const lines = threadLines({
      messages: [
        {
          messageId: id(301),
          mine: false,
          senderName: "Daniel",
          body: THEIRS,
          viaQ: false,
          unsent: false,
          sentAt: "2026-10-06T17:28:35Z",
        },
        {
          messageId: id(302),
          mine: true,
          senderName: "Zino",
          body: DRAFT_2,
          viaQ: false,
          unsent: false,
          sentAt: "2026-10-07T15:43:31Z",
        },
      ],
      jobs: [sent],
      done: [
        doneItem(
          40,
          "2026-10-07T15:43:31Z",
          "Replies to Tensorgate’s meeting invitation",
          REL_T,
          "Tensorgate",
        ),
      ],
      relationshipId: REL_T,
    });
    expect(lines.map((line) => line.side)).toEqual(["THEM", "US"]);
    expect(lines[0]?.byQ).toBeNull();
    expect(lines[1]?.byQ?.why).toBe(
      "Replies to Tensorgate’s meeting invitation",
    );
    expect(lines[1]?.byQ?.drafts.map((d) => d.attempt)).toEqual([1, 2]);
    expect(lines[1]?.byQ?.verdict).toBe(
      "The reviewer passed it (8.4 against a bar of 7.5).",
    );
  });
});

describe("a standing instruction's message card (recovery D-15)", () => {
  it("is a message, like Q's own: app.chat.message.send reads as a reply to send", () => {
    expect(isChatSend("app.chat.message.send")).toBe(true);
    expect(isChatSend("chat.message.send")).toBe(true);
    expect(isChatSend("email.send")).toBe(false);
    const view = QApprovalViewSchema.parse({
      ...chatView(APPROVAL_T, REL_T, "Thank you, Zino."),
      action: {
        ...chatView(APPROVAL_T, REL_T, "Thank you, Zino.").action,
        actionType: "app.chat.message.send",
        summary:
          "Reply to Zino Aviation about how regulated firms evaluate it.",
      },
    });
    const [group] = decisionGroups({
      approvals: [
        pending(APPROVAL_T, "2026-10-07T15:43:31Z", "Reply to Zino Aviation"),
      ],
      views: new Map([[APPROVAL_T, view]]),
      jobs: [],
      now: NOW,
    });
    const item = group?.items[0];
    if (item === undefined || item.kind !== "APPROVAL")
      throw new Error("no card");
    expect(decisionTitle(item)).toBe("Reply ready to send");
  });
});
