// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  InterestDto,
  RelationshipStatusDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

/**
 * The relationship surface (CQ-WEB-030).
 *
 * Properties, not snapshots: every state is said in words (never a badge,
 * a score or a percentage); a side's timeline says who can see each entry;
 * "Needs you" holds only a step that is the person's own; acting re-reads
 * the page from the server once the server has confirmed; and "Ask Q"
 * opens Q with the relationship drafted as the question.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const askAbout = vi.fn();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout, open: false, setOpen: () => undefined }),
}));

const expressInterestAction = vi.fn<(input: unknown) => Promise<unknown>>();
vi.mock("../src/features/network/interest-actions", () => ({
  expressInterestAction: (input: unknown) => expressInterestAction(input),
  answerInterestAction: () => Promise.reject(new Error("not used")),
}));

const { RelationshipList, RelationshipNeedsYou } =
  await import("../src/features/relationships/relationship-list");
const { RelationshipTimeline } =
  await import("../src/features/relationships/relationship-timeline");
const { AskQAboutRelationship, InvestorRelationshipActions } =
  await import("../src/features/relationships/relationship-actions");
const words = await import("../src/features/relationships/relationship-words");

configure({ asyncUtilTimeout: 8000 });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const COMPANY_ID = "22222222-0000-4000-8000-000000000001";
const INVESTOR_ID = "11111111-0000-4000-8000-000000000013";

function summary(
  over: Partial<RelationshipSummaryDto> & {
    readonly nextStep: RelationshipSummaryDto["nextStep"];
  },
): RelationshipSummaryDto {
  return {
    relationshipId: `33333333-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
    counterpart: { kind: "COMPANY", id: COMPANY_ID, name: "Harbour Labs" },
    state: "INTEREST_EXPRESSED",
    stateSince: "2026-09-20T09:00:00.000Z",
    ...over,
  };
}

const NO_SCORE = /%|score|match|🎉|!/i;

describe("relationship words", () => {
  it("says every state and next step in words, without celebration or a score", () => {
    for (const state of [
      "DISCOVERED",
      "INTEREST_EXPRESSED",
      "CONNECTED",
      "DECLINED",
    ] as const) {
      expect(words.STATE_WORDS[state]).not.toMatch(NO_SCORE);
      for (const side of ["INVESTOR", "COMPANY"] as const) {
        expect(words.milestoneSentence(state, side, "Apex")).not.toMatch(
          NO_SCORE,
        );
      }
    }
    for (const step of [
      "EXPRESS_INTEREST",
      "AWAIT_ANSWER",
      "ANSWER_INTEREST",
      "SCHEDULE_MEETING",
      "NONE",
    ] as const) {
      expect(words.nextStepSentence(step, "Apex")).not.toMatch(NO_SCORE);
    }
    expect(words.milestoneSentence("CONNECTED", "INVESTOR", "Apex")).toBe(
      "Both sides agreed to connect.",
    );
  });

  it("points a connected relationship at booking a call, which exists (BIZ-008)", () => {
    expect(words.nextStepSentence("SCHEDULE_MEETING", "Apex")).toBe(
      "A first call is the natural next step. Book one with Apex here, or send them a message.",
    );
  });

  it("opens each side's own relationship page", () => {
    expect(words.relationshipHref(summary({ nextStep: "AWAIT_ANSWER" }))).toBe(
      `/relationships/company/${COMPANY_ID}`,
    );
    expect(
      words.relationshipHref(
        summary({
          nextStep: "ANSWER_INTEREST",
          counterpart: {
            kind: "INVESTOR_ORGANISATION",
            id: INVESTOR_ID,
            name: "Apex Ventures",
          },
        }),
      ),
    ).toBe(`/relationships/investor/${INVESTOR_ID}`);
  });

  it("puts only the person's own steps in Needs you", () => {
    const items = [
      summary({ nextStep: "EXPRESS_INTEREST", state: "DISCOVERED" }),
      summary({ nextStep: "AWAIT_ANSWER" }),
      summary({ nextStep: "ANSWER_INTEREST" }),
      summary({ nextStep: "SCHEDULE_MEETING", state: "CONNECTED" }),
      summary({ nextStep: "NONE", state: "DECLINED" }),
    ];
    expect(
      words.relationshipsNeedingYou(items).map((item) => item.nextStep),
    ).toEqual(["ANSWER_INTEREST", "SCHEDULE_MEETING"]);
  });
});

describe("relationship words after a meeting (relationship-state.v2)", () => {
  it("says every new state and step plainly: a pass is not a rejection", () => {
    for (const state of [
      "MEETING_HELD",
      "IN_DILIGENCE",
      "PAUSED",
      "PASSED",
      "INVESTED",
    ] as const) {
      expect(words.STATE_WORDS[state]).not.toMatch(NO_SCORE);
      expect(words.STATE_WORDS[state]).not.toMatch(/reject/i);
      for (const side of ["INVESTOR", "COMPANY"] as const) {
        expect(words.milestoneSentence(state, side, "Apex")).not.toMatch(
          /reject|declin/i,
        );
      }
    }
    expect(words.STATE_WORDS.PASSED).toBe("Not proceeding for now");
    expect(words.milestoneSentence("PASSED", "COMPANY", "Apex")).toBe(
      "Apex decided not to proceed for now.",
    );
    for (const step of ["DECIDE_NEXT_STEP", "FOLLOW_UP", "RESUME"] as const) {
      expect(words.nextStepSentence(step, "Apex")).not.toMatch(NO_SCORE);
      expect(words.NEXT_STEP_WORDS[step].length).toBeGreaterThan(0);
    }
  });

  it("after a call, deciding and following up need you; a pass does not", () => {
    const items = [
      summary({ nextStep: "DECIDE_NEXT_STEP", state: "MEETING_HELD" }),
      summary({ nextStep: "FOLLOW_UP", state: "IN_DILIGENCE" }),
      summary({ nextStep: "NONE", state: "PASSED" }),
    ];
    expect(
      words.relationshipsNeedingYou(items).map((item) => item.nextStep),
    ).toEqual(["DECIDE_NEXT_STEP", "FOLLOW_UP"]);
  });
});

describe("RelationshipList", () => {
  it("renders one link row per counterpart with state, date and next step", () => {
    render(
      <RelationshipList
        items={[
          summary({ nextStep: "AWAIT_ANSWER" }),
          summary({
            nextStep: "SCHEDULE_MEETING",
            state: "CONNECTED",
            counterpart: {
              kind: "COMPANY",
              id: "22222222-0000-4000-8000-000000000002",
              name: "Northwind",
            },
          }),
        ]}
        emptySentence="None yet."
      />,
    );
    const list = screen.getByRole("list", { name: "Relationships" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe(
      `/relationships/company/${COMPANY_ID}`,
    );
    expect(links[0]?.textContent).toContain(
      "Interest expressed since 20 Sept 2026",
    );
    expect(links[1]?.textContent).toContain("Connected");
    expect(list.textContent).not.toMatch(/%|score|match/i);
    // No counts, no badges: the list is rows of words.
    expect(list.querySelector("[data-badge], .cq-badge")).toBeNull();
  });

  it("says one sentence when there are none", () => {
    render(<RelationshipList items={[]} emptySentence="None yet." />);
    expect(screen.getByText("None yet.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("RelationshipNeedsYou", () => {
  it("renders nothing when nothing is the person's to do", () => {
    const { container } = render(
      <RelationshipNeedsYou items={[summary({ nextStep: "AWAIT_ANSWER" })]} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names the action and links to the relationship", () => {
    render(
      <RelationshipNeedsYou
        items={[
          summary({
            nextStep: "ANSWER_INTEREST",
            counterpart: {
              kind: "INVESTOR_ORGANISATION",
              id: INVESTOR_ID,
              name: "Apex Ventures",
            },
          }),
        ]}
      />,
    );
    const link = screen.getByRole("link", {
      name: /Answer Apex Ventures's interest/,
    });
    expect(link.getAttribute("href")).toBe(
      `/relationships/investor/${INVESTOR_ID}`,
    );
  });
});

describe("RelationshipTimeline", () => {
  const milestones: RelationshipStatusDto["milestones"] = [
    { state: "DISCOVERED", at: "2026-09-18T09:00:00.000Z" },
    { state: "INTEREST_EXPRESSED", at: "2026-09-19T09:00:00.000Z" },
    { state: "CONNECTED", at: "2026-09-21T09:00:00.000Z" },
  ];

  it("dates each entry and says who can see it", () => {
    render(
      <RelationshipTimeline
        milestones={milestones}
        side="INVESTOR"
        counterpart="Harbour Labs"
      />,
    );
    const entries = within(
      screen.getByRole("list", { name: "What happened" }),
    ).getAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(entries[0]?.textContent).toContain("Only your side can see this");
    expect(entries[1]?.textContent).toContain("Shared with Harbour Labs");
    expect(entries[2]?.textContent).toContain("Both sides agreed to connect.");
    const times = entries.map((entry) =>
      entry.querySelector("time")?.getAttribute("dateTime"),
    );
    expect(times).toEqual(milestones.map((milestone) => milestone.at));
  });

  it("shows a same-day back-and-forth once, with how many times it happened", () => {
    const messy: RelationshipStatusDto["milestones"] = [
      { state: "CONNECTED", at: "2026-09-27T09:00:00.000Z" },
      ...[1, 2, 3, 4].flatMap((n) => [
        { state: "PASSED" as const, at: `2026-10-03T0${n}:00:00.000Z` },
        { state: "CONNECTED" as const, at: `2026-10-03T0${n}:30:00.000Z` },
      ]),
    ];
    render(
      <RelationshipTimeline
        milestones={messy}
        side="INVESTOR"
        counterpart="Harbour Labs"
      />,
    );
    const entries = within(
      screen.getByRole("list", { name: "What happened" }),
    ).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[1]?.textContent).toContain(
      "Then: Both sides agreed to connect.",
    );
    expect(entries[1]?.textContent).toContain("happened 4 times that day");
  });

  it("does not merge the same step on different days", () => {
    render(
      <RelationshipTimeline
        milestones={[
          { state: "CONNECTED", at: "2026-09-27T09:00:00.000Z" },
          { state: "CONNECTED", at: "2026-09-29T09:00:00.000Z" },
        ]}
        side="INVESTOR"
        counterpart="Harbour Labs"
      />,
    );
    expect(
      within(screen.getByRole("list", { name: "What happened" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
  });
});

describe("relationship actions", () => {
  it("re-reads the page only after the server confirms an interest", async () => {
    const interest: InterestDto = {
      interestId: "77777777-0000-4000-8000-000000000009",
      relationshipId: "33333333-0000-4000-8000-000000000009",
      companyId: COMPANY_ID,
      status: "EXPRESSED",
      expressedAt: "2026-09-25T10:00:00.000Z",
      response: "PENDING",
      respondedAt: null,
      connection: null,
    };
    let settle: (value: unknown) => void = () => undefined;
    expressInterestAction.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(
      <InvestorRelationshipActions
        companyId={COMPANY_ID}
        companyName="Harbour Labs"
        interest={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Express interest" }));
    const group = screen.getByRole("group", {
      name: "Express interest in Harbour Labs",
    });
    fireEvent.click(
      within(group).getByRole("button", { name: "Express interest" }),
    );
    expect(refresh).not.toHaveBeenCalled();
    settle({ ok: true, value: { interest, deduplicated: false } });
    await screen.findByText("Interest expressed in Harbour Labs.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not re-read on a refusal", async () => {
    expressInterestAction.mockResolvedValue({
      ok: false,
      message: "Your interest was not sent. Try again.",
      retryable: true,
    });
    render(
      <InvestorRelationshipActions
        companyId={COMPANY_ID}
        companyName="Harbour Labs"
        interest={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Express interest" }));
    const group = screen.getByRole("group");
    fireEvent.click(
      within(group).getByRole("button", { name: "Express interest" }),
    );
    await screen.findByText("Your interest was not sent. Try again.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("Ask Q opens Q with the relationship as the drafted question", () => {
    // jsdom has no matchMedia; the Aperture reads reduced motion from it.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })),
    );
    render(<AskQAboutRelationship counterpart="Harbour Labs" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Ask Q about this relationship/ }),
    );
    expect(askAbout).toHaveBeenCalledTimes(1);
    expect(askAbout.mock.calls[0]?.[0]).toMatch(/Harbour Labs/);
  });
});
