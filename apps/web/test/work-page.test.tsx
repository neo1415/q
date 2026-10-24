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

describe("Work, Tasks as an inbox with its preview (option 2, 2026-10-21)", () => {
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
    expect(
      screen.getByRole("heading", { name: /Needs you\s*1 waiting on you/u }),
    ).toBeTruthy();
    // In the queue, and open in the preview beside it.
    expect(
      screen.getAllByText("Q is waiting to be let in: Introductory call"),
    ).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
    noticeItems.current = [];
  });

  it("a new person sees the input, what Q suggests, and honest empty states", () => {
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
    expect(
      screen.getByText(
        "Nothing waits for you. Q will ask when something does.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Nothing done yet today.")).toBeTruthy();
    expect(
      screen.getByText(/Nothing running\. Give Q a task above/u),
    ).toBeTruthy();
    // Nothing waits: the preview says so plainly.
    expect(screen.getByText("You’re clear")).toBeTruthy();
  });

  it("a picked suggestion asks Q once to prepare it, then approves that exact card", async () => {
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
    fireEvent.click(
      screen.getByRole("button", { name: /Kazikit hasn’t replied/ }),
    );
    // Nothing is asked of Q until the person says prepare it.
    expect(ask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Prepare it" }));
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(stalled.prompt);
    expect(screen.getByText("Send Ama a short follow-up")).toBeTruthy();
    expect(screen.getByText("Hi Ama, following up on Kazikit.")).toBeTruthy();
    // The track says where it is: the yes is the step now.
    const track = screen.getByRole("list", { name: "Where this is" });
    expect(
      within(track).getByText("Your yes").closest("li")?.dataset["step"],
    ).toBe("now");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await settle();
    expect(approve).toHaveBeenCalledWith(APPROVAL);
    expect(
      within(track).getByText("Your yes").closest("li")?.dataset["step"],
    ).toBe("done");
  });

  it("dismissing what was prepared declines it and sets the suggestion aside", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Prepare it" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settle();
    expect(reject).toHaveBeenCalledWith(APPROVAL);
    expect(dismiss).toHaveBeenCalledWith(stalled.key);
    expect(screen.queryByRole("button", { name: /Kazikit/ })).toBeNull();
    expect(approve).not.toHaveBeenCalled();
  });

  it("opens the first decision beside the queue with its exact content", async () => {
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
    expect(
      screen.getByRole("heading", { name: /Needs you\s*1 waiting on you/u }),
    ).toBeTruthy();
    await settle();
    const detail = document.querySelector("[data-work-detail]");
    expect(detail).not.toBeNull();
    // No "Review" tap: the decision is open in the preview.
    expect(within(detail as HTMLElement).getByText("Hi Ngozi")).toBeTruthy();
    expect(
      within(detail as HTMLElement).getByRole("button", { name: "Approve" }),
    ).toBeTruthy();
    expect(
      within(detail as HTMLElement).getByRole("button", { name: "Dismiss" }),
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

  it("lists running work as one line, and pauses it from its preview", async () => {
    paused.mockResolvedValue({ ok: true, value: null });
    render(
      <WorkPage
        suggestions={[]}
        approvals={[]}
        work={[instruction]}
        done={{ items: [], thisWeek: 9, nextCursor: null }}
      />,
    );
    const row = screen.getByRole("button", {
      name: /Keep my founder conversations moving/u,
    });
    expect(within(row).getByText("Replied to Tallyloom")).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText("$1.84 of $5.00 this month")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await settle();
    expect(paused).toHaveBeenCalledWith(instruction.id, true);
    expect(screen.getByText("Paused by you")).toBeTruthy();
    // The queue, in order: needs your yes, running, done this week.
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((one) => one.textContent ?? "");
    const at = (prefix: string) =>
      headings.findIndex((one) => one.startsWith(prefix));
    expect(at("Needs you")).toBeLessThan(at("Moving"));
    expect(at("Moving")).toBeLessThan(at("Done today"));
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

  it("wears each option's tone: gold for Tasks and the plan, warm charcoal for Cost", async () => {
    const { workforceFixtures } = await import("../app/dev/workforce/fixtures");
    const fixtures = workforceFixtures(Date.now());
    const { container } = render(
      <WorkPage
        suggestions={[]}
        approvals={[]}
        work={[]}
        done={null}
        workforce={{ overview: fixtures.overview, jobs: fixtures.jobs }}
      />,
    );
    const page = container.querySelector("[data-work-page]");
    expect(page?.classList.contains("cq-gold")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /^Cost/u }));
    expect(page?.classList.contains("cq-charcoal")).toBe(true);
    expect(page?.classList.contains("cq-gold")).toBe(false);
  });
});

describe("How Q is handling it and Cost (options 2 and 3, 2026-10-21)", () => {
  it("shows each piece of Q's work as its plan, and the month day by day", async () => {
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
    // The decision queue comes first; the plan is one tap away.
    expect(document.querySelector("[data-work-plan]")).toBeNull();
    const team = screen.getByRole("radio", { name: "How Q is handling it" });
    fireEvent.click(team);
    expect(team.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-work-plan]")).not.toBeNull();
    expect(screen.getByText("Working towards")).toBeTruthy();
    // Every job the team is on, and every standing instruction, is listed.
    expect(document.querySelectorAll("[data-plan-entry]").length).toBe(
      fixtures.jobs.length + (fixtures.overview.instructions?.length ?? 0),
    );

    fireEvent.click(screen.getByRole("radio", { name: /^Cost/u }));
    expect(screen.getByRole("heading", { name: "Each day" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "By job" })).toBeTruthy();
    // Nothing read from the server during the test.
    expect(loadWorkforce).not.toHaveBeenCalled();
  });

  it("leaves the switch out where the page has no team", () => {
    render(<WorkPage suggestions={[]} approvals={[]} work={[]} done={null} />);
    expect(
      screen.queryByRole("radio", { name: "How Q is handling it" }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: /^Cost/u })).toBeNull();
  });
});
