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

// Q's team is read again on the server; the page's tests never call it.
const loadWorkforce = vi.fn<() => Promise<unknown>>(() =>
  Promise.resolve(null),
);
vi.mock("../src/features/work/workforce-actions", () => ({
  loadWorkforceAction: () => loadWorkforce(),
  moreWorkforceJobsAction: () => Promise.resolve(null),
}));
vi.mock("../src/features/chat/chat-actions", () => ({
  chatThreadAction: () => Promise.resolve({ ok: false, message: "x" }),
  sendChatMessageAction: () => Promise.resolve({ ok: false, message: "x" }),
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
    // Empty states say what happens next (2026-10-08).
    expect(
      screen.getByText(/Nothing waits on you\. When Q drafts a reply/u),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing done yet\./u)).toBeTruthy();
    expect(
      screen.getByText(/Nothing running\. Give Q a task above/u),
    ).toBeTruthy();
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

  it("lists what needs them with a count, each card showing its exact content", async () => {
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
      .getByRole("heading", { name: /Needs you\s*1/u })
      .closest("section");
    expect(section).not.toBeNull();
    await settle();
    // No "Review" tap: the card is open in the queue.
    expect(within(section as HTMLElement).getByText("Hi Ngozi")).toBeTruthy();
    expect(
      within(section as HTMLElement).getByRole("button", { name: "Approve" }),
    ).toBeTruthy();
  });

  it("shows the picture of who an approval names, and initials when there is none", () => {
    // The queue reads each card as it shows it.
    read.mockResolvedValue({ ok: false });
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
    expect(
      screen.getByRole("heading", { name: /In progress\s*1/u }),
    ).toBeTruthy();
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
    // One page, in order: what needs them, what was done, what runs.
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((one) => one.textContent ?? "");
    expect(
      headings.findIndex((one) => one.startsWith("Needs you")),
    ).toBeLessThan(headings.findIndex((one) => one.startsWith("Done for you")));
    expect(
      headings.findIndex((one) => one.startsWith("Done for you")),
    ).toBeLessThan(headings.findIndex((one) => one.startsWith("In progress")));
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

describe("Work's team map and cost, secondary (P7, 2026-10-08)", () => {
  it("shows Q's team as a map with every specialist, and the month's cost", async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    // jsdom does no layout; a tab scrolls itself into view in a browser.
    Element.prototype.scrollIntoView = () => undefined;
    const { workforceFixtures } = await import("../app/dev/workforce/fixtures");
    const fixtures = workforceFixtures(Date.now());
    render(
      <WorkPage
        suggestions={[]}
        approvals={[]}
        work={[]}
        done={null}
        workforce={{ overview: fixtures.overview, jobs: fixtures.jobs }}
      />,
    );
    // The decision queue comes first; the map is one tap away.
    expect(document.querySelectorAll("[data-agent]").length).toBe(0);
    const team = screen.getByRole("button", { name: "Team map" });
    fireEvent.click(team);
    expect(team.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll("[data-agent]").length).toBe(9);
    expect(
      screen
        .getAllByRole("status")
        .some((one) => /Live/u.test(one.textContent ?? "")),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /^Cost/u }));
    expect(screen.getByRole("heading", { name: "By specialist" })).toBeTruthy();
    expect(screen.getByRole("meter", { name: /monthly limit/u })).toBeTruthy();
    // Nothing read from the server during the test.
    expect(loadWorkforce).not.toHaveBeenCalled();
  });

  it("leaves the team map and cost out where the page has no team", () => {
    render(<WorkPage suggestions={[]} approvals={[]} work={[]} done={null} />);
    expect(screen.queryByRole("button", { name: "Team map" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cost/u })).toBeNull();
  });
});
