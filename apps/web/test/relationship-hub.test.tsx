// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HubNavigation,
  HubRelated,
} from "@/features/relationships/hub-navigation";
import {
  hubViewOf,
  pipelineLayoutOf,
  pipelineListHref,
} from "@/features/relationships/hub-view";
import {
  controlOf,
  manifestControls,
  resetControls,
} from "@/features/q/control/registry";
import { performOnControl } from "@/features/q/control/perform";
import { noteRoute, resetRouteState } from "@/features/q/control/route-state";
import { currentManifest } from "@/features/q/manifest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  results: vi.fn(),
  relationships: vi.fn(),
  digests: vi.fn(),
  notices: vi.fn(),
  reminders: vi.fn(),
  commitments: vi.fn(),
  steps: vi.fn(),
}));
vi.mock("next/navigation", async (load) => ({
  ...(await load<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/features/q/context", () => ({
  resolveOwnContext: mocks.context,
  apiSession: mocks.session,
  qApiSession: mocks.session,
}));
vi.mock("@/features/relationships/relationship-data", () => ({
  ownRelationships: mocks.relationships,
  relationshipDigests: mocks.digests,
  relationshipSteps: mocks.steps,
  unreadByRelationship: vi.fn().mockResolvedValue(new Map()),
  ownCommitmentFacts: vi.fn().mockResolvedValue({}),
}));
vi.mock("@capital-q/api-client", async (load) => ({
  ...(await load<typeof import("@capital-q/api-client")>()),
  getResults: mocks.results,
  listNotifications: mocks.notices,
  listReminders: mocks.reminders,
  getChatUnread: vi.fn().mockResolvedValue({ items: [] }),
  getRelationshipCommitments: mocks.commitments,
}));
vi.mock("@/features/results/results-dashboard", () => ({
  ResultsDashboard: ({
    results,
  }: {
    readonly results: { readonly organisationName: string };
  }) => <div>{results.organisationName}</div>,
}));
const { default: RelationshipsPage } =
  await import("../app/(app)/relationships/page");

afterEach(() => {
  cleanup();
  resetControls();
  resetRouteState();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    baseUrl: "https://test.invalid",
    accessToken: "fixture",
  });
  mocks.context.mockResolvedValue({
    kind: "INVESTOR",
    investorOrganisationId: "a0000000-0000-4000-8000-000000000001",
    label: "Fund",
  });
  mocks.relationships.mockResolvedValue([]);
  mocks.notices.mockResolvedValue({ items: [] });
  mocks.reminders.mockResolvedValue({ items: [] });
  mocks.steps.mockResolvedValue([]);
});

async function overview() {
  render(
    await RelationshipsPage({
      searchParams: Promise.resolve({ view: "overview" }),
    }),
  );
}

/** Needs you starts folded (owner 2026-10-16); open it to read its rows. */
function openNeedsYou() {
  fireEvent.click(screen.getByRole("button", { name: /^Needs you/u }));
}

describe("Hub foundation", () => {
  it("opens the Overview by default and keeps old record-list links on the Pipeline", () => {
    // Owner 2026-10-16: a bare /relationships (the sidebar's CRM) opens the
    // Overview, as /crm does; unknown views fail to it too.
    expect(hubViewOf(undefined)).toBe("overview");
    expect(hubViewOf("invalid")).toBe("overview");
    expect(hubViewOf("relationships")).toBe("pipeline");
    expect(hubViewOf("pipeline")).toBe("pipeline");
    expect(hubViewOf("overview")).toBe("overview");
    expect(hubViewOf("capital")).toBe("capital");
    expect(pipelineLayoutOf(undefined)).toBe("list");
    expect(pipelineLayoutOf("table")).toBe("table");
    expect(pipelineLayoutOf("board")).toBe("board");
    expect(pipelineLayoutOf("x")).toBe("list");
    expect(
      pipelineListHref({ view: "relationships", q: "kivu", cursor: "drop" }),
    ).toBe("/relationships?view=pipeline&layout=list&q=kivu");
    expect(pipelineListHref({ view: "pipeline" })).toBeNull();
  });
  it("offers investor inbox without founder-only application links", () => {
    render(
      <>
        <HubRelated side="INVESTOR" />
        <HubNavigation view="overview" />
      </>,
    );
    expect(
      screen
        .getByRole("link", { name: "Investment inbox" })
        .getAttribute("href"),
    ).toBe("/gateq?tab=inbox");
    // Capital is the CRM's own tab now (owner 2026-10-16), not a link out.
    expect(
      screen.getByRole("link", { name: "Capital" }).getAttribute("href"),
    ).toBe("/relationships?view=capital");
    expect(screen.queryByRole("link", { name: "My applications" })).toBeNull();
    expect(
      manifestControls().find((entry) => entry.id === "tab.overview")?.state,
    ).toBe("SELECTED");
    expect(currentManifest()?.filters).toMatchObject({ view: "overview" });
  });
  it("offers founder applications without investor inbox or sidebar repeats", () => {
    render(
      <>
        <HubRelated side="COMPANY" />
        <HubNavigation view="pipeline" />
      </>,
    );
    expect(
      screen
        .getByRole("link", { name: "My applications" })
        .getAttribute("href"),
    ).toBe("/gateq?tab=applications");
    // Q Work and Discover are sidebar entries: not repeated here. Capital
    // is one of the CRM's own tabs (owner 2026-10-16), exactly once.
    for (const name of ["Q Work", "Discover"])
      expect(screen.queryByRole("link", { name })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Capital" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Investment inbox" })).toBeNull();
    // Q's old id stays stable: it names the Pipeline tab now.
    for (const id of ["tab.pipeline", "tab.relationships"])
      expect(manifestControls().find((entry) => entry.id === id)?.state).toBe(
        "SELECTED",
      );
  });
  it("registers only rendered role destinations and confirms already selected tab", async () => {
    render(<HubNavigation view="overview" side="COMPANY" />);
    expect(
      manifestControls().some((entry) => entry.id === "button.hub-gateq"),
    ).toBe(true);
    noteRoute("/relationships?view=overview");
    const entry = controlOf("tab.overview");
    expect(entry).toBeDefined();
    if (entry === undefined) throw new Error("Missing overview control");
    expect(
      await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_huboverview01",
        act: "SELECT_TAB",
        target: "tab.overview",
      }),
    ).toBe("DONE");
  });
  it("confirms a tab switch only after the actual route and selected state settle", async () => {
    const page = render(
      <>
        <HubRelated side="INVESTOR" />
        <HubNavigation view="overview" />
      </>,
    );
    noteRoute("/relationships?view=overview");
    const link = screen.getByRole("link", { name: "Pipeline" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      page.rerender(
        <>
          <HubRelated side="INVESTOR" />
          <HubNavigation view="pipeline" />
        </>,
      );
      noteRoute("/relationships?view=pipeline");
    });
    const entry = controlOf("tab.relationships");
    if (entry === undefined) throw new Error("Missing relationships control");
    let receipt: string | undefined;
    await act(async () => {
      receipt = await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_hubrecords01",
        act: "SELECT_TAB",
        target: "tab.relationships",
      });
    });
    expect(receipt).toBe("DONE");
    expect(
      screen
        .getByRole("link", { name: "Pipeline" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
  it("renders authorized investor overview and never loads hidden board data", async () => {
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Authorized fund",
      pipelineFit: [],
    });
    await overview();
    expect(
      screen.getByRole("heading", { name: "Investment Hub" }),
    ).toBeDefined();
    expect(screen.getByText("Authorized fund")).toBeDefined();
    // The queue reads the person's own list to name its rows; the list's
    // per-row reads (digests) stay the Relationships tab's.
    expect(mocks.digests).not.toHaveBeenCalled();
    expect(mocks.results).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fixture" }),
      { range: "30d" },
    );
  });
  it("exposes only authorized loaded counterpart IDs to Q", async () => {
    const companyId = "c0000000-0000-4000-8000-000000000001";
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [{ companyId, companyName: "Company", state: "CONNECTED" }],
    });
    await overview();
    expect(
      currentManifest()?.sections.find(
        (section) => section.id === "hub-overview",
      )?.refs,
    ).toEqual([{ kind: "COMPANY", id: companyId }]);
    expect(
      manifestControls().some((entry) => entry.id === "list.relationships"),
    ).toBe(false);
  });
  it("renders the founder perspective from its own authorized read", async () => {
    mocks.context.mockResolvedValue({
      kind: "FOUNDER",
      companyId: "c0000000-0000-4000-8000-000000000001",
      label: "Company",
    });
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      organisationName: "Founder company",
      pipeline: { rows: [], byState: [] },
    });
    await overview();
    expect(
      screen.getByRole("heading", { name: "Fundraising Hub" }),
    ).toBeDefined();
    expect(screen.getByText("Founder company")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Investment inbox" })).toBeNull();
  });
  it("does not expose a conflicting role projection", async () => {
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      organisationName: "Private company",
      pipeline: { rows: [], byState: [] },
    });
    await overview();
    expect(screen.getByText("The period report couldn't load")).toBeDefined();
    expect(screen.queryByText("Private company")).toBeNull();
  });
  it("shows recoverable failure rather than fabricated zero counts", async () => {
    mocks.results.mockRejectedValue(new Error("Unavailable"));
    await overview();
    expect(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href"),
    ).toBe("/relationships?view=overview");
  });
  it("shows setup for confirmed absent context without querying scoped data", async () => {
    mocks.context.mockResolvedValue({ kind: "NONE" });
    await overview();
    expect(
      screen.getByRole("link", { name: "Set up" }).getAttribute("href"),
    ).toBe("/welcome");
    expect(mocks.results).not.toHaveBeenCalled();
  });
  it("keeps unavailable context distinct from absent organisation", async () => {
    mocks.context.mockResolvedValue({ kind: "NONE", unavailable: true });
    await overview();
    expect(screen.getByText("The period report couldn't load")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Set up" })).toBeNull();
  });
});

describe("the Overview's Needs you queue (research 2026-10-15 §3.3)", () => {
  const companyId = "c0000000-0000-4000-8000-000000000009";
  const relationship = {
    relationshipId: "d0000000-0000-4000-8000-000000000009",
    counterpart: { kind: "COMPANY" as const, id: companyId, name: "Kivu" },
    state: "CONNECTED" as const,
    stateSince: "2026-10-10T10:00:00.000Z",
    nextStep: "SCHEDULE_MEETING" as const,
  };
  const notice = (n: number) => ({
    id: `e0000000-0000-4000-8000-00000000000${String(n)}`,
    kind: "CHAT_MESSAGE" as const,
    title: `Kivu sent message ${String(n)}`,
    body: null,
    linkPath: `/relationships/company/${companyId}/messages`,
    read: false,
    createdAt: `2026-10-1${String(n)}T10:00:00.000Z`,
    priority: "NEEDS_YOU" as const,
  });
  beforeEach(() => {
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [],
    });
  });

  it("leads with what needs the person, folded per relationship, before the period", async () => {
    mocks.relationships.mockResolvedValue([relationship]);
    mocks.notices.mockResolvedValue({ items: [notice(1), notice(2)] });
    await overview();
    openNeedsYou();
    const queue = screen.getByRole("region", { name: /Needs you/u });
    const rows = within(queue).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Kivu");
    expect(rows[0]?.textContent).toContain("2 updates");
    expect(
      within(queue).getByRole("link", { name: "Reply" }).getAttribute("href"),
    ).toBe(`/relationships/company/${companyId}/messages`);
    // The queue comes before the period's figures in reading order.
    const period = screen.getByText("Fund");
    expect(
      queue.compareDocumentPosition(period) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists the Pipeline's own steps and Capital's money steps too (live check 2026-10-16)", async () => {
    const { nextStepFor } =
      await import("@/features/relationships/relationships-view");
    const decide = {
      ...relationship,
      relationshipId: "d0000000-0000-4000-8000-000000000010",
      counterpart: { ...relationship.counterpart, name: "Ajopot" },
      nextStep: "DECIDE_NEXT_STEP" as const,
    };
    const money = {
      ...relationship,
      relationshipId: "d0000000-0000-4000-8000-000000000011",
      counterpart: { ...relationship.counterpart, name: "Ledgerfold" },
    };
    const now = Date.parse("2026-10-16T10:00:00.000Z");
    mocks.relationships.mockResolvedValue([decide, money]);
    mocks.steps.mockResolvedValue([
      {
        item: decide,
        step: nextStepFor(decide, undefined, "INVESTOR", now, "/r/a"),
        at: decide.stateSince,
      },
      {
        item: money,
        step: nextStepFor(
          money,
          {
            unread: 0,
            followUpDue: false,
            nextCallAt: null,
            lastMessageAt: null,
            diligence: null,
            commitment: {
              next: "MARK_SENT",
              amount: "250000",
              currencyCode: "USD",
            },
          },
          "INVESTOR",
          now,
          "/r/l",
        ),
        at: money.stateSince,
      },
    ]);
    await overview();
    openNeedsYou();
    const queue = screen.getByRole("region", { name: /Needs you/u });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(2);
    expect(within(queue).getByText("Ajopot")).toBeDefined();
    expect(
      within(queue)
        .getByRole("link", { name: "Mark as sent" })
        .getAttribute("href"),
    ).toBe("/relationships?view=capital#commitments");
    expect(within(queue).getByText("Commitment USD 250,000")).toBeDefined();
    // A step leaves when it is done: no dismiss on it.
    expect(
      within(queue).queryByRole("button", { name: /Dismiss/u }),
    ).toBeNull();
    expect(screen.queryByText(/Nothing needs you right now\./u)).toBeNull();
  });

  it("says nothing needs them, not a blank area", async () => {
    await overview();
    openNeedsYou();
    expect(screen.getByText(/Nothing needs you right now\./u)).toBeDefined();
  });

  it("is partial, never 'nothing', when the notices cannot be read", async () => {
    mocks.notices.mockRejectedValue(new Error("down"));
    await overview();
    openNeedsYou();
    expect(
      screen.getByText(/What needs you couldn't be read just now/u),
    ).toBeDefined();
    expect(screen.queryByText(/Nothing needs you right now\./u)).toBeNull();
  });

  it("keeps the queue when only the period report fails", async () => {
    mocks.relationships.mockResolvedValue([relationship]);
    mocks.notices.mockResolvedValue({ items: [notice(1)] });
    mocks.results.mockRejectedValue(new Error("down"));
    await overview();
    openNeedsYou();
    expect(screen.getByRole("region", { name: /Needs you/u })).toBeDefined();
    expect(screen.getByText("The period report couldn't load")).toBeDefined();
  });

  it("caps the queue at five rows and opens the rest on request", async () => {
    const many = Array.from({ length: 7 }, (_, n) => ({
      ...notice(n),
      id: `e0000000-0000-4000-8000-0000000000${String(10 + n)}`,
      kind: "Q_WORK" as const,
      title: `Review plan ${String(n)}`,
      linkPath: null,
    }));
    mocks.notices.mockResolvedValue({ items: many });
    await overview();
    openNeedsYou();
    const queue = screen.getByRole("region", { name: /Needs you/u });
    expect(within(queue).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(within(queue).getByRole("button", { name: "See all 7" }));
    expect(within(queue).getAllByRole("listitem")).toHaveLength(7);
  });
});

describe("S2: the Pipeline is the one record list", () => {
  it("redirects an old Relationships link to the Pipeline's List layout", async () => {
    const thrown: unknown = await RelationshipsPage({
      searchParams: Promise.resolve({ view: "relationships", q: "kivu" }),
    }).catch((error: unknown) => error);
    const digest =
      thrown instanceof Error && "digest" in thrown
        ? String(thrown.digest)
        : "";
    expect(digest).toContain("/relationships?view=pipeline&layout=list&q=kivu");
  });

  it("opens the list under the Pipeline tab, with List current and Table and Board beside it", async () => {
    mocks.digests.mockResolvedValue({});
    render(
      await RelationshipsPage({
        searchParams: Promise.resolve({ view: "pipeline", layout: "list" }),
      }),
    );
    expect(
      screen
        .getByRole("link", { name: "Pipeline" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("link", { name: "Relationships" })).toBeNull();
    const layouts = screen.getByRole("group", { name: "Layout" });
    expect(
      within(layouts)
        .getByRole("link", { name: "List" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(layouts).getByRole("link", { name: "Table" }).getAttribute("href"),
    ).toContain("view=pipeline&layout=table");
    expect(
      manifestControls().some((entry) => entry.id === "tab.pipeline-list"),
    ).toBe(true);
  });

  it("opens a bare /relationships on the Overview, never a redirect loop", async () => {
    // Owner 2026-10-16: the CRM's front page is the Overview.
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [],
    });
    render(await RelationshipsPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen
        .getByRole("link", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("group", { name: "Layout" })).toBeNull();
  });
});

describe("S4: the investor's portfolio on the Overview", () => {
  const invested = (n: number, since: string) => ({
    relationshipId: `d0000000-0000-4000-8000-00000000010${String(n)}`,
    counterpart: {
      kind: "COMPANY" as const,
      id: `c0000000-0000-4000-8000-00000000010${String(n)}`,
      name: `Portfolio ${String(n)}`,
    },
    state: "INVESTED" as const,
    stateSince: since,
    nextStep: "NONE" as const,
  });
  const current = (status: string) => ({
    current: {
      id: "e0000000-0000-4000-8000-000000000101",
      amount: "250000.00",
      currencyCode: "USD",
      level: "FIRM",
      status,
      source: "PERSON",
      quote: null,
      statedByYourSide: true,
      statedAt: "2026-10-01T10:00:00.000Z",
      confirmedAt: null,
      note: null,
      meetingId: null,
      canConfirm: false,
    },
    history: [],
    detected: [],
    connected: true,
  });
  beforeEach(() => {
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [],
    });
  });

  it("lists invested companies only, newest first, each with its money in words", async () => {
    mocks.relationships.mockResolvedValue([
      invested(1, "2026-09-01T10:00:00.000Z"),
      invested(2, "2026-10-01T10:00:00.000Z"),
      {
        ...invested(3, "2026-10-02T10:00:00.000Z"),
        state: "CONNECTED" as const,
      },
    ]);
    mocks.commitments.mockImplementation((_session: unknown, id: string) =>
      id.endsWith("101")
        ? Promise.resolve(current("RECEIVED"))
        : Promise.reject(new Error("down")),
    );
    await overview();
    const section = screen.getByRole("region", { name: /Portfolio/u });
    const rows = within(section).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Portfolio 2"),
      expect.stringContaining("Portfolio 1"),
    ]);
    expect(rows[1]?.textContent).toContain("USD 250,000 · received");
    // Unknown stays unknown: a failed read is said, never zero.
    expect(rows[0]?.textContent).toContain("Commitment couldn't be read");
    expect(rows[0]?.getAttribute("href")).toBe(
      "/relationships/company/c0000000-0000-4000-8000-000000000102",
    );
  });

  it("says none yet when nothing is invested, and unavailable when the list fails", async () => {
    await overview();
    expect(screen.getByText(/No investments recorded yet/u)).toBeDefined();
    cleanup();
    mocks.relationships.mockResolvedValue(undefined);
    await overview();
    expect(
      screen.getByText(/Your portfolio couldn't be read just now/u),
    ).toBeDefined();
  });

  it("says confirmed money is not yet an investment, beside the empty portfolio (live check 2026-10-16)", async () => {
    mocks.results.mockResolvedValue({
      side: "INVESTOR",
      organisationName: "Fund",
      pipelineFit: [],
      commitments: [
        {
          status: "CONFIRMED",
          currencyCode: "USD",
          count: 1,
          amount: "250000",
        },
      ],
    });
    await overview();
    const section = screen.getByRole("region", { name: /Portfolio/u });
    expect(section.textContent).toContain("No investments recorded yet");
    expect(section.textContent).toContain(
      "1 commitment is confirmed and not yet received (USD 250,000).",
    );
    expect(
      within(section)
        .getByRole("link", { name: "Open Capital" })
        .getAttribute("href"),
    ).toBe("/relationships?view=capital#commitments");
  });

  it("is the investor's alone: a founder's Overview has no portfolio", async () => {
    mocks.context.mockResolvedValue({
      kind: "FOUNDER",
      companyId: "c0000000-0000-4000-8000-000000000001",
      label: "Company",
    });
    mocks.results.mockResolvedValue({
      side: "FOUNDER",
      organisationName: "Founder company",
      pipeline: { rows: [], byState: [] },
    });
    await overview();
    expect(screen.queryByRole("region", { name: /Portfolio/u })).toBeNull();
    expect(mocks.commitments).not.toHaveBeenCalled();
  });
});
