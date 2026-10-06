// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationDto } from "@capital-q/contracts";

import {
  QApprovalViewSchema,
  QPendingApprovalSchema,
  QWorkDtoSchema,
  type QApprovalView,
  type QWorkSuggestionDto,
} from "@capital-q/contracts";

const approve = vi.fn<(id: string) => Promise<unknown>>();
const reject = vi.fn<(id: string) => Promise<unknown>>();
const read = vi.fn<(id: string) => Promise<unknown>>();
const ask = vi.fn<(text: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  approveQApprovalAction: (id: string) => approve(id),
  rejectQApprovalAction: (id: string) => reject(id),
  readQApprovalAction: (id: string) => read(id),
  askQAction: (text: string) => ask(text),
}));
vi.mock("../src/features/q/q-session", () => ({
  useQSessionOptional: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../src/features/integrations/email-draft-editor", () => ({
  EmailDraftEditor: () => null,
}));
const prepared = vi.fn<(runId: string) => Promise<unknown>>();
const dismiss = vi.fn<(key: string) => Promise<unknown>>();
const paused = vi.fn<(id: string, paused: boolean) => Promise<unknown>>();
vi.mock("../src/features/work/work-page-actions", () => ({
  preparedAction: (runId: string) => prepared(runId),
  dismissSuggestionAction: (key: string) => dismiss(key),
  setPausedAction: (id: string, value: boolean) => paused(id, value),
  listDoneAction: () => Promise.resolve({ ok: false, message: "x" }),
}));
vi.mock("../src/features/work/work-actions", () => ({
  answerWorkAction: () => Promise.resolve({ ok: true, value: null }),
  stopWorkAction: () => Promise.resolve({ ok: true, value: null }),
  markReadAction: () => Promise.resolve({ ok: true, value: null }),
}));

// What the bell (and the Work count) holds; each test sets its own.
const noticeItems: { current: NotificationDto[] } = { current: [] };
vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({
    items: noticeItems.current,
    unread: 0,
    failed: false,
    nextBefore: null,
  }),
  noticesRead: () => undefined,
  refreshNotices: () => Promise.resolve(),
}));

const { WorkPage, readPlan } = await import("../src/features/work/work-page");

afterEach(() => {
  cleanup();
  for (const mock of [approve, reject, read, ask, prepared, dismiss, paused]) {
    mock.mockReset();
  }
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

const RUN = "00000000-0000-4000-8000-0000000000b1";
const APPROVAL = "00000000-0000-4000-8000-0000000000a1";

const stalled: QWorkSuggestionDto = {
  key: "stalled_reply:00000000-0000-4000-8000-000000000001",
  kind: "STALLED_REPLY",
  lead: 6,
  unit: "days",
  subject: "Kazikit hasn’t replied",
  question: "Follow up?",
  prompt: "Kazikit hasn't replied in 6 days. Prepare a follow-up.",
  linkPath: "/relationships/company/00000000-0000-4000-8000-000000000002",
};

function view(preview: string): QApprovalView {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId: APPROVAL,
    runId: RUN,
    status: "PENDING",
    requestedAt: "2026-10-04T09:00:00Z",
    expiresAt: "2026-10-05T09:00:00Z",
    canDecide: true,
    action: {
      actionId: "00000000-0000-4000-8000-0000000000c1",
      actionType: "chat.send",
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [
        { kind: "COMPANY", companyId: "00000000-0000-4000-8000-0000000000d1" },
      ],
      summary: "Send Ama a short follow-up",
      preview,
    },
  });
}

const instruction = QWorkDtoSchema.parse({
  id: "00000000-0000-4000-8000-0000000000e1",
  kind: "STANDING_INSTRUCTION",
  status: "ACTIVE",
  summary: "Keep my founder conversations moving",
  createdAt: "2026-10-01T09:00:00Z",
  expiresAt: "2026-11-01T09:00:00Z",
  lanes: [],
  goal: "Keep my founder conversations moving",
  run: { state: "WORKING", pauseReason: null },
  lastStep: { words: "Replied to Tallyloom", at: "2026-10-04T08:00:00Z" },
  spend: { spentUsdMonth: "1.84", budgetUsdMonth: "5.00" },
});

describe("Work (WORK-58)", () => {
  it("lists what the Work count counts: a notice that needs them (founder 2026-10-05)", () => {
    noticeItems.current = [
      {
        id: "11111111-0000-4000-8000-000000000001",
        kind: "Q_MESSAGE",
        title: "Q is waiting to be let in: Introductory call",
        body: null,
        linkPath: "/relationships/company/x",
        read: false,
        createdAt: new Date().toISOString(),
        priority: "NEEDS_YOU",
      },
    ];
    render(
      <WorkPage
        suggestions={[]}
        approvals={[]}
        work={[]}
        done={{ items: [], thisWeek: 0, nextCursor: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: /Needs you/ })).toBeTruthy();
    expect(
      screen.getByText("Q is waiting to be let in: Introductory call"),
    ).toBeTruthy();
    expect(screen.queryByText("Nothing running yet.")).toBeNull();
    noticeItems.current = [];
  });

  it("a new person sees the input and what Q suggests, nothing else", () => {
    render(
      <WorkPage
        suggestions={[stalled]}
        approvals={[]}
        work={[]}
        done={{ items: [], thisWeek: 0, nextCursor: null }}
      />,
    );
    expect(screen.getByLabelText("Give Q a task")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Talk to Q" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Q suggests" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Running/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Needs you/ })).toBeNull();
    expect(screen.getByText("Nothing running yet.")).toBeTruthy();
  });

  it("a tapped card asks Q once to prepare it, then shows the plan and approves that card", async () => {
    ask.mockResolvedValue({
      ok: true,
      value: { runId: RUN, conversationId: null },
    });
    prepared.mockResolvedValue({
      ok: true,
      value: { state: "APPROVAL", approvalId: APPROVAL },
    });
    read.mockResolvedValue({
      ok: true,
      value: view("Hi Ama, following up on Kazikit."),
    });
    approve.mockResolvedValue({ ok: true, value: null });
    render(
      <WorkPage suggestions={[stalled]} approvals={[]} work={[]} done={null} />,
    );
    const card = screen.getByRole("button", { name: /Kazikit hasn’t replied/ });
    fireEvent.click(card);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(stalled.prompt);
    expect(screen.getByText("Send Ama a short follow-up")).toBeTruthy();
    expect(screen.getByText("Hi Ama, following up on Kazikit.")).toBeTruthy();
    // Closing and reopening never asks Q again.
    fireEvent.click(card);
    fireEvent.click(card);
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await settle();
    expect(approve).toHaveBeenCalledWith(APPROVAL);
  });

  it("'Not now' declines what was prepared for the card and sets it aside", async () => {
    ask.mockResolvedValue({
      ok: true,
      value: { runId: RUN, conversationId: null },
    });
    prepared.mockResolvedValue({
      ok: true,
      value: { state: "APPROVAL", approvalId: APPROVAL },
    });
    read.mockResolvedValue({ ok: true, value: view("Hi Ama") });
    reject.mockResolvedValue({ ok: true, value: null });
    dismiss.mockResolvedValue({ ok: true, value: null });
    render(
      <WorkPage suggestions={[stalled]} approvals={[]} work={[]} done={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kazikit/ }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await settle();
    expect(reject).toHaveBeenCalledWith(APPROVAL);
    expect(dismiss).toHaveBeenCalledWith(stalled.key);
    expect(screen.queryByRole("button", { name: /Kazikit/ })).toBeNull();
  });

  it("lists what needs them with a count, and Review opens the exact card", async () => {
    read.mockResolvedValue({ ok: true, value: view("Hi Ngozi") });
    render(
      <WorkPage
        suggestions={[]}
        approvals={[
          QPendingApprovalSchema.parse({
            approvalId: APPROVAL,
            runId: RUN,
            conversationId: null,
            summary: "Reply to Clinicrest",
            requestedAt: "2026-10-04T09:00:00Z",
            expiresAt: "2026-10-05T09:00:00Z",
          }),
        ]}
        work={[]}
        done={null}
      />,
    );
    const section = screen
      .getByRole("heading", { name: "Needs you, 1" })
      .closest("section");
    expect(section).not.toBeNull();
    fireEvent.click(
      within(section as HTMLElement).getByRole("button", { name: "Review" }),
    );
    await settle();
    expect(screen.getByText("Hi Ngozi")).toBeTruthy();
  });

  it("shows the picture of who an approval names, and the icon when there is none", () => {
    const LOGO = "https://storage.test/object/sign/cq-profile-images/l?t=1";
    const pending = (named: unknown) =>
      QPendingApprovalSchema.parse({
        approvalId: APPROVAL,
        runId: RUN,
        conversationId: null,
        summary: "Reply to Clinicrest",
        requestedAt: "2026-10-04T09:00:00Z",
        expiresAt: "2026-10-05T09:00:00Z",
        named,
      });
    const { container, unmount } = render(
      <WorkPage
        suggestions={[]}
        approvals={[
          pending({
            kind: "COMPANY",
            id: "22222222-0000-4000-8000-000000000002",
            photoUrl: LOGO,
          }),
        ]}
        work={[]}
        done={null}
      />,
    );
    const section = container.querySelector("[data-work-needs-you]");
    expect(section?.querySelector("img")?.getAttribute("src")).toBe(LOGO);
    unmount();
    const without = render(
      <WorkPage
        suggestions={[]}
        approvals={[
          pending({
            kind: "COMPANY",
            id: "22222222-0000-4000-8000-000000000002",
            photoUrl: null,
          }),
        ]}
        work={[]}
        done={null}
      />,
    );
    expect(
      without.container.querySelector("[data-work-needs-you] img"),
    ).toBeNull();
    expect(
      without.container.querySelector(
        "[data-work-needs-you] [data-entity-avatar]",
      ),
    ).toBeNull();
  });

  it("shows running work in one line with its spend, and pauses it behind a tap", async () => {
    paused.mockResolvedValue({ ok: true, value: null });
    render(
      <WorkPage
        suggestions={[]}
        approvals={[]}
        work={[instruction]}
        done={{ items: [], thisWeek: 9, nextCursor: null }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Running, 1" })).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("$1.84")).toBeTruthy();
    expect(screen.getByText("$1.84 this month")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Options for Keep my founder conversations moving",
      }),
    );
    await settle();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pause" }));
    await settle();
    expect(paused).toHaveBeenCalledWith(instruction.id, true);
    expect(screen.getByText("Paused")).toBeTruthy();
    // Done is its own view, one tap away, not a section under the rest.
    const done = screen.getByRole("tab", { name: /Done/ });
    expect(done.getAttribute("aria-selected")).toBe("false");
    expect(
      screen
        .getByRole("tab", { name: /In progress/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("lays a grant out as what Q does alone and what it asks, keeping the full text", () => {
    const plan = readPlan(
      'Your goal: "x"\n\nOn my own, within working hours:\n- express interest\n- send chat messages (up to 8 per person, then I ask)\n\nI ask you first:\n- book a meeting\n\nBudget: $5.00 a month',
    );
    expect(plan.alone).toBe("express interest, send chat messages");
    expect(plan.asks).toBe("book a meeting");
    expect(plan.rest).toContain("Budget: $5.00 a month");
    expect(readPlan("Hi Ama").quote).toBe("Hi Ama");
  });
});
