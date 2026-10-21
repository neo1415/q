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

import {
  GATEQ_INBOX_VIEWS,
  type GateqInboxDto,
  type GateqInboxItemDto,
  type GateqInboxView,
} from "@capital-q/contracts";

/**
 * F4: the investor's GateQ inbox in the browser. The keys, bulk selection
 * and the pass that always needs a reason; server calls are doubles (the
 * component runs in its demo mode, which never calls the server).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../src/features/gateq/page/gateq-actions", () => ({
  archiveAction: vi.fn(),
  assignAction: vi.fn(),
  labelAction: vi.fn(),
  loadDetailAction: vi.fn(),
  noteAction: vi.fn(),
  passAction: vi.fn(),
  replyAction: vi.fn(),
  starAction: vi.fn(),
}));

const model = await import("../src/features/gateq/page/inbox-model");
const { InboxView } = await import("../src/features/gateq/page/inbox-view");

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();
// jsdom has no layout: behave as a desktop, with the preview pane.
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (
  n: number,
  over: Partial<GateqInboxItemDto>,
): GateqInboxItemDto => ({
  applicationId: id(n),
  reference: `ga_${n}`,
  companyName: `Company ${n}`,
  oneLiner: null,
  stage: "Seed",
  sector: "Fintech",
  country: "Nigeria",
  raise: null,
  fit: "FITS",
  rules: { met: 4, total: 4, unknown: 0 },
  starred: false,
  unread: true,
  labels: [],
  assignee: null,
  folder: "INBOX",
  replyBy: null,
  replyState: "NONE",
  daysLeft: null,
  submittedAt: "2026-10-05T09:00:00.000Z",
  ...over,
});

function inbox(items: GateqInboxItemDto[], canDecide = true): GateqInboxDto {
  return {
    gateway: {
      id: id(900),
      name: "Seed gate",
      publicId: "gq_x",
      replyWithinDays: 10,
    },
    viewer: { userId: id(901), canDecide, solo: false },
    view: "INBOX",
    counts: Object.fromEntries(GATEQ_INBOX_VIEWS.map((v) => [v, 0])) as Record<
      GateqInboxView,
      number
    >,
    items,
    labels: ["IC next week"],
    members: [{ userId: id(901), name: "Daniel Reyes", initials: "DR" }],
  };
}

const ITEMS = [
  item(1, { companyName: "Sunline Energy" }),
  item(2, { companyName: "Kora Health" }),
  item(3, {
    companyName: "Mosaic",
    fit: "NOT_A_FIT",
    rules: { met: 3, total: 4, unknown: 0 },
  }),
];

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key });
  });
}

describe("the inbox's words (pure)", () => {
  it("maps Gmail's keys, and never while typing or with a modifier", () => {
    const at = (key: string, tagName = "DIV", ctrlKey = false) =>
      model.shortcutFor({
        key,
        ctrlKey,
        metaKey: false,
        altKey: false,
        target: { tagName },
      });
    expect(["j", "k", "e", "s", "#", "/"].map((k) => at(k))).toEqual([
      "NEXT",
      "PREVIOUS",
      "ARCHIVE",
      "STAR",
      "PASS",
      "SEARCH",
    ]);
    expect(at("j", "INPUT")).toBeNull();
    expect(at("e", "TEXTAREA")).toBeNull();
    expect(at("s", "DIV", true)).toBeNull();
  });

  it("says the reply clock and the rules plainly, and never invents a promise", () => {
    expect(
      model.replyWords({
        replyState: "DUE_SOON",
        daysLeft: 2,
        folder: "INBOX",
      }),
    ).toEqual({ text: "2 days left", warn: true });
    expect(
      model.replyWords({ replyState: "OVERDUE", daysLeft: -1, folder: "INBOX" })
        ?.warn,
    ).toBe(true);
    expect(
      model.replyWords({ replyState: "NONE", daysLeft: null, folder: "INBOX" }),
    ).toBeNull();
    expect(model.rulesWords({ met: 3, total: 4, unknown: 1 })).toBe(
      "3 of 4 rules, 1 needing clarification",
    );
    expect(model.chipsFor(true).map(([v]) => v)).not.toContain(
      "ASSIGNED_TO_ME",
    );
  });

  it("labels Q's view as a view, from the engine's band only", () => {
    expect(model.qView(item(1, {})).lead).toBe("Worth a look");
    expect(model.qView(item(1, { fit: "NOT_A_FIT" })).lead).toBe(
      "Outside your rules",
    );
    expect(
      model.qView(
        item(1, { fit: "PARTIAL", rules: { met: 3, total: 4, unknown: 1 } }),
      ).why,
    ).toMatch(/unclear rule is not a rejection/);
  });

  it("F28: a gate with no rules is never 'Fits your rules'", () => {
    const none = item(1, { rules: { met: 0, total: 0, unknown: 0 } });
    expect(model.fitWordsFor(none)).toBe("No rules yet");
    expect(model.fitGlyphFor(none)).toBe("unk");
    expect(model.rulesWords(none.rules)).toBe("Nothing checked");
    expect(model.qView(none).lead).toBe("Nothing checked yet");
    expect(model.qView(none).why).not.toMatch(/Meets every rule/);
    expect(model.qView(none).why).toMatch(/Draft criteria from your mandate/);
    expect(model.fitWordsFor(item(2, {}))).toBe("Fits your rules");
  });
});

function pick<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no row ${String(index)}`);
  return value;
}

describe("gateq-2's saved views and dossier words (pure)", () => {
  const me = id(901);
  const ROWS = [
    item(1, {}),
    item(2, { replyState: "OVERDUE", daysLeft: -2 }),
    item(3, { replyState: "DUE_SOON", daysLeft: 0 }),
    item(4, {
      fit: "NOT_A_FIT",
      assignee: { userId: me, name: "Daniel Reyes", initials: "DR" },
    }),
    item(5, { fit: "PARTIAL", rules: { met: 2, total: 4, unknown: 2 } }),
    item(6, { rules: { met: 0, total: 0, unknown: 0 } }),
    item(7, { folder: "ARCHIVED" }),
  ];

  it("counts each view by the server's own rules, inbox folder only", () => {
    expect(model.paneCounts(ROWS, me)).toEqual({
      ALL: 6,
      FIRST: 3,
      TODAY: 2,
      MINE: 1,
      OUTSIDE: 1,
    });
    // F28: no published rules is never "look at first".
    expect(model.inPane(pick(ROWS, 5), "FIRST", me)).toBe(false);
    expect(model.inPane(pick(ROWS, 6), "ALL", me)).toBe(false);
  });

  it("says why and when in words, and never invents a promise", () => {
    expect(model.paneWhy(pick(ROWS, 0))).toBe("Meets every rule of your gate.");
    expect(model.paneWhy(pick(ROWS, 1))).toMatch(/reply promise is close/);
    expect(model.paneWhy(pick(ROWS, 4))).toBe(
      "Not enough information to decide: 2 rules not answered.",
    );
    expect(model.qualifiesOf(pick(ROWS, 5))).toBe("NO_RULES");
    expect(model.dueWords(pick(ROWS, 1))).toEqual({
      text: "Reply overdue",
      late: true,
    });
    expect(model.dueWords(pick(ROWS, 2))?.text).toBe("Reply today");
    expect(
      model.dueWords({
        replyState: "ON_TRACK",
        daysLeft: 4,
        folder: "INBOX",
        replyBy: "2026-10-24",
      })?.text,
    ).toBe("Reply by 24 Oct");
    expect(model.dueWords(pick(ROWS, 0))).toBeNull();
  });

  it("keeps a group they did not cover as not covered, never a zero", () => {
    const rows = model.onePageSummary(
      { companyName: "Mosaic", raise: { amount: "1500000", currency: "USD" } },
      null,
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Company",
      "Round",
      "Traction",
      "Market",
    ]);
    expect(rows[1]?.value).toBe("$1,500,000. Founder stated");
    expect(rows[2]?.value).toBeNull();
    expect(model.openQuestions(null)).toEqual([]);
    expect(
      model.draftAsk({
        founderName: "Ada Obi",
        fund: "Northbound",
        questions: ["What is retention across the paid contracts?"],
      }),
    ).toMatch(/^Hi Ada,[\s\S]*- What is retention/);
    expect(model.monogram("Tessellate Labs")).toBe("TL");
    expect(model.monogram("quillwork")).toBe("QU");
  });
});

describe("the inbox, driven like an investor", () => {
  const render3 = (canDecide = true) =>
    render(
      <InboxView
        inbox={inbox(ITEMS, canDecide)}
        state="full"
        initialDetail={null}
        gateLink="https://capitalq.app/g/x"
        fund="Northbound Capital"
        demo={{ details: {} }}
      />,
    );

  it("moves with j/k, stars with s and archives with e", () => {
    render3();
    const list = screen.getByRole("listbox", { name: "Applications" });
    press("j");
    expect(
      within(list).getAllByRole("option")[1]?.getAttribute("aria-selected"),
    ).toBe("true");
    press("s");
    expect(
      screen
        .getByRole("button", { name: "Unstar Kora Health" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    press("e");
    expect(within(list).queryByText("Kora Health")).toBeNull();
    expect(within(list).getAllByRole("option")).toHaveLength(2);
  });

  it("selects several and acts on them together", () => {
    render3();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Sunline Energy" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Mosaic" }));
    const bar = screen.getByRole("toolbar", { name: "2 selected" });
    fireEvent.click(within(bar).getByRole("button", { name: /Archive/ }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(
      within(
        screen.getByRole("listbox", { name: "Applications" }),
      ).getAllByRole("option"),
    ).toHaveLength(1);
  });

  it("opens search with /", () => {
    render3();
    press("/");
    fireEvent.change(screen.getByLabelText("Search applications"), {
      target: { value: "mos" },
    });
    expect(
      within(
        screen.getByRole("listbox", { name: "Applications" }),
      ).getAllByRole("option"),
    ).toHaveLength(1);
  });

  it("asks for a reason before a pass can be sent, and # opens it", () => {
    render3();
    press("j");
    press("j");
    press("#");
    const send = screen.getByRole("button", { name: "Approve and send pass" });
    // The draft is there; a reason is pre-chosen from the rules and can be changed.
    expect(screen.getByLabelText(/Message to the founder/)).toBeTruthy();
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByLabelText(/Message to the founder/), {
      target: { value: "" },
    });
    expect(
      screen
        .getByRole("button", { name: "Approve and send pass" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("gives a member no way to pass, book or ask for the firm", () => {
    render3(false);
    for (const name of ["Pass with a reason", "Book a call", "Ask for more"]) {
      expect(
        screen
          .getAllByRole("button", { name })
          .every((b) => b.hasAttribute("disabled")),
      ).toBe(true);
    }
    press("#");
    expect(
      screen.queryByRole("button", { name: "Approve and send pass" }),
    ).toBeNull();
    expect(
      screen.getByText(
        /you can read applications, add notes and download packs/,
      ),
    ).toBeTruthy();
  });

  it("narrows to a saved view at once, with its count", () => {
    render(
      <InboxView
        inbox={inbox([
          ...ITEMS,
          item(4, {
            companyName: "Quillwork",
            replyState: "OVERDUE",
            daysLeft: -1,
          }),
        ])}
        state="full"
        initialDetail={null}
        gateLink="https://capitalq.app/g/x"
        fund="Northbound Capital"
        demo={{ details: {} }}
      />,
    );
    const views = screen.getByRole("navigation", { name: "Views" });
    const today = within(views).getByRole("button", { name: /Reply today/ });
    expect(today.textContent).toContain("1");
    fireEvent.click(today);
    expect(today.getAttribute("aria-pressed")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Applications" });
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    expect(within(list).getByText("Quillwork")).toBeTruthy();
    // Overdue is said in words, not colour alone.
    expect(within(list).getByText("Reply overdue")).toBeTruthy();
    fireEvent.click(
      within(views).getByRole("button", { name: /Outside your rules/ }),
    );
    expect(within(list).getByText("Mosaic")).toBeTruthy();
    expect(within(list).getByText("Doesn't qualify")).toBeTruthy();
  });

  it("prepares a call for approval; nothing is sent from the dossier", () => {
    render3();
    fireEvent.click(screen.getByRole("button", { name: "Book a call" }));
    const message = screen.getByLabelText(/Message to the founder/);
    expect((message as HTMLTextAreaElement).value).toMatch(/30-minute call/);
    expect(
      screen.getByText(/Nothing is sent until you approve this exact message/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve and send" }),
    ).toBeTruthy();
  });
});
