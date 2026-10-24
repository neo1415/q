// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("../src/features/work/report-actions", () => ({
  sendReportStepAction: vi.fn(),
}));
vi.mock("../src/features/daily/daily-actions", () => ({
  requestDailyEditionAction: vi.fn(),
  setDailyPreferencesAction: vi.fn(),
}));
vi.mock("../src/features/pitch/pitch-actions", () => ({
  authorisePitchPlaybackAction: vi.fn(() =>
    Promise.resolve({ ok: false, message: "no" }),
  ),
  setPitchDetailsAction: vi.fn(),
}));
vi.mock("../src/features/documents/requests/request-actions", () => ({
  loadFolderAccessAction: vi.fn(),
  loadDocumentAccessAction: vi.fn(),
  revokeAccessAction: vi.fn(() => Promise.resolve({ ok: true })),
  shareFolderAction: vi.fn(() => Promise.resolve({ ok: true })),
  setFolderLevelAction: vi.fn(),
  shareDocumentAction: vi.fn(),
}));
vi.mock("../src/features/onboarding-kit/api-actions", () => ({
  onboardingCurrentAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: null }),
  ),
  onboardingResolveSuggestionAction: vi.fn(),
}));

import type {
  MediaAssetDto,
  QDailyEdition,
  QDailyStory,
  QRehearsalDto,
  QWorkReportDto,
} from "@capital-q/contracts";

import * as dailyActions from "../src/features/daily/daily-actions";
import { DataRoomTab } from "../src/features/documents/requests/data-room-tab";
import * as requestActions from "../src/features/documents/requests/request-actions";
import { DailyPaper } from "../src/features/daily/daily-paper";
import { DailyOff } from "../src/features/daily/daily-states";
import * as pitchActions from "../src/features/pitch/pitch-actions";
import { PitchMain } from "../src/features/pitch/pitch-main";
import { RehearsalReview } from "../src/features/rehearsal/rehearsal-review";
import { RehearsalsHome } from "../src/features/rehearsal/rehearsals-home";
import { FirstStageReport } from "../src/features/work/first-stage-report";
import * as reportActions from "../src/features/work/report-actions";

/**
 * The chosen Work designs (2026-10-21) in a browser: each page's states
 * and the logic behind its buttons. Every send goes through the person's
 * approval of the exact words; nothing shows a value the server did not
 * send.
 */

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("the first-stage report", () => {
  const report: QWorkReportDto = {
    counterpartName: "Pellucid Health",
    writtenAt: "2026-10-19T10:00:00.000Z",
    headline: "Paying NHS customers",
    howItWent: "Sam answered every question.",
    strengths: [
      { point: "Paying customers in three NHS trusts", basis: "CLAIM" },
    ],
    concerns: [{ point: "Sales cycles may run long", basis: "INFERENCE" }],
    openQuestions: ["What is your runway today?"],
    recommendation: "MAYBE",
    why: "Two gaps are worth a call.",
    interview: [
      {
        question: "Who pays you?",
        answer: "Three NHS trusts pay us today.",
        byQ: false,
      },
    ],
    relationshipId: UUID(1),
    companyId: UUID(2),
    laneOpen: true,
  };

  it("puts Q's verdict first, in words, with its recommended step first", () => {
    render(
      <FirstStageReport
        report={report}
        delegationId={UUID(3)}
        laneId={UUID(4)}
      />,
    );
    expect(screen.getByRole("heading", { name: "Q is unsure" })).toBeTruthy();
    const steps = within(
      screen.getByRole("group", { name: "Prepared next steps" }),
    ).getAllByRole("button");
    expect(steps.map((step) => step.getAttribute("data-step"))).toEqual([
      "QUESTIONS",
      "CALL",
      "PASS",
    ]);
    expect(screen.getAllByText("Prepared, needs your yes")).toHaveLength(3);
    const table = document.querySelector("[data-findings]");
    expect(table?.textContent).toContain("Founder’s claim");
    expect(table?.textContent).toContain("Q’s inference");
  });

  it("sends exactly the words approved, edits included, and only then", async () => {
    vi.mocked(reportActions.sendReportStepAction).mockResolvedValue({
      ok: true,
      stopped: true,
    });
    render(
      <FirstStageReport
        report={report}
        delegationId={UUID(3)}
        laneId={UUID(4)}
      />,
    );
    fireEvent.click(document.querySelector('[data-step="PASS"]') as Element);
    expect(reportActions.sendReportStepAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", {
      name: "What Q will send, word for word",
    });
    fireEvent.change(box, { target: { value: "Thank you, not for us." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
      await Promise.resolve();
    });
    expect(reportActions.sendReportStepAction).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: UUID(3),
        laneId: UUID(4),
        step: "PASS",
        body: "Thank you, not for us.",
      }),
    );
    expect(
      await screen.findByText("Sent. Q has stopped working on this one."),
    ).toBeTruthy();
  });

  it("says why a step cannot be sent when there is no conversation yet", () => {
    render(
      <FirstStageReport
        report={{ ...report, relationshipId: null }}
        delegationId={UUID(3)}
        laneId={UUID(4)}
      />,
    );
    fireEvent.click(document.querySelector('[data-step="CALL"]') as Element);
    expect(
      screen.getByText(
        "There is no conversation with them yet, so nothing can be sent.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve and send" }),
    ).toBeNull();
  });
});

describe("the rehearsal review", () => {
  const rehearsal: QRehearsalDto = {
    id: UUID(10),
    counterpart: { kind: "INVESTOR_ORGANISATION", id: UUID(11), name: "Mina" },
    userRole: "FOUNDER",
    status: "FINISHED",
    outcome: "STRONG_LATER",
    meetingId: null,
    voice: "FEMALE",
    difficulty: "REALISTIC",
    metrics: {
      yourShareOfWords: 60,
      longestAnswerWords: 40,
      exchanges: 2,
      minutes: 14,
    },
    previousScore: 64,
    persona: { summary: "", style: "", priorities: [], grounding: "SOME" },
    turns: [
      {
        from: "THEM",
        text: "Do you have a lead?",
        at: "2026-10-01T10:00:00Z",
        mood: null,
        sawScreen: false,
      },
      {
        from: "YOU",
        text: "We’re raising a few million to hire sellers.",
        at: "2026-10-01T10:01:00Z",
        mood: null,
        sawScreen: false,
      },
    ],
    review: {
      overall: "Clear on product; the numbers came late.",
      score: 72,
      dimensions: [],
      wentRight: [{ moment: "Owned the lack of a lead.", why: "" }],
      wentWrong: [
        {
          moment: "The ask was vague: raising a few million.",
          why: "",
          better: "Say the amount.",
        },
        { moment: "Overall pacing.", why: "", better: "Slow down." },
      ],
      tips: [],
    },
    createdAt: "2026-10-01T10:00:00.000Z",
    endedAt: "2026-10-01T10:14:00.000Z",
  };

  const part = (selector: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`nothing matches ${selector}`);
    return found;
  };

  it("ties a note to the line it is about, and says when it is about the whole", () => {
    render(<RehearsalReview rehearsal={rehearsal} />);
    expect(screen.getByText("7.2")).toBeTruthy();
    expect(screen.getByText("Up 0.8 since last time (6.4)")).toBeTruthy();
    // The feedback list (the end card names the same moments above it).
    const feedback = within(part("[data-review-feedback]"));
    fireEvent.click(
      feedback.getByRole("button", { name: /The ask was vague/u }),
    );
    expect(
      document.querySelector("[data-lit]")?.getAttribute("data-line"),
    ).toBe("1");
    fireEvent.click(feedback.getByRole("button", { name: /Overall pacing/u }));
    expect(document.querySelector("[data-lit]")).toBeNull();
    expect(
      screen.getByText("About the rehearsal as a whole, not one line."),
    ).toBeTruthy();
  });

  // Owner 2026-10-24: the end card -- how long, the strongest and weakest
  // moments with when they were said, and the notes kept on the board.
  it("ends with a card of its moments and a way to keep them", () => {
    render(<RehearsalReview rehearsal={rehearsal} />);
    const end = within(part("[data-end-card]"));
    expect(end.getByText("How it went")).toBeTruthy();
    expect(end.getByText("Strongest moments")).toBeTruthy();
    expect(end.getByText("To work on")).toBeTruthy();
    expect(end.getByText("Owned the lack of a lead.")).toBeTruthy();
    expect(
      end.getByRole("button", { name: "Save notes to my board" }),
    ).toBeTruthy();
    // A moment about no one line has no time and opens nothing.
    expect(end.getByRole("button", { name: /Overall pacing/u })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("has nothing to review when they left before answering", () => {
    render(
      <RehearsalReview
        rehearsal={{
          ...rehearsal,
          outcome: "LEFT_EARLY",
          review: null,
          metrics: { ...rehearsal.metrics, exchanges: 0 },
        }}
      />,
    );
    expect(screen.getByText("Nothing to review yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start again" })).toBeTruthy();
  });
});

describe("the Rehearsals tab", () => {
  const counterpart = {
    kind: "INVESTOR_ORGANISATION" as const,
    id: UUID(20),
    name: "Northmoor Capital",
  };
  it("draws a call to rehearse, one still open, and each past review's state", () => {
    render(
      <RehearsalsHome
        basePath="/rehearsals"
        titled={false}
        partners={{
          role: "FOUNDER",
          upcoming: [
            {
              meetingId: UUID(21),
              startsAt: "2026-10-23T14:00:00.000Z",
              purpose: "Intro call",
              counterpart,
            },
          ],
          people: [],
        }}
        history={{
          rehearsals: [
            {
              id: UUID(30),
              counterpart,
              status: "ACTIVE",
              outcome: null,
              score: null,
              exchanges: 1,
              createdAt: "2026-10-20T10:00:00.000Z",
            },
            {
              id: UUID(31),
              counterpart,
              status: "FINISHED",
              outcome: "STRONG_LATER",
              score: 76,
              exchanges: 6,
              createdAt: "2026-10-14T10:00:00.000Z",
              review: {
                state: "READY",
                wentWell: "Calm on margins.",
                workOn: "Say what the team does.",
              },
            },
            {
              id: UUID(32),
              counterpart,
              status: "FINISHED",
              outcome: null,
              score: null,
              exchanges: 3,
              createdAt: "2026-10-13T10:00:00.000Z",
            },
            {
              id: UUID(33),
              counterpart,
              status: "FINISHED",
              outcome: "LEFT_EARLY",
              score: null,
              exchanges: 0,
              createdAt: "2026-10-12T10:00:00.000Z",
            },
          ],
        }}
        allowance={{
          words: "2 rehearsals left this month on your Pro plan.",
          out: false,
        }}
        withId={null}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Rejoin" }).getAttribute("href"),
    ).toBe(`/rehearsals/live/${UUID(30)}`);
    expect(
      [...document.querySelectorAll("[data-past]")].map((row) =>
        row.getAttribute("data-past"),
      ),
    ).toEqual(["IN_PROGRESS", "READY", "WRITING", "NOTHING_TO_REVIEW"]);
    expect(screen.getByText("7.6")).toBeTruthy();
    expect(screen.getByText(/Work on: Say what the team does\./u)).toBeTruthy();

    fireEvent.click(document.querySelector('[data-past="READY"]') as Element);
    expect(screen.getByText("Calm on margins.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the full review" })
        .getAttribute("href"),
    ).toBe(`/rehearsals/r/${UUID(31)}`);
  });

  it("sends a chosen difficulty to the lobby, and offers a plan change when the month is used", () => {
    render(
      <RehearsalsHome
        basePath="/rehearsals"
        partners={{
          role: "FOUNDER",
          upcoming: [],
          people: [
            {
              counterpart,
              relationshipId: UUID(40),
              state: "CONNECTED",
              lastRehearsal: null,
            },
          ],
        }}
        history={{ rehearsals: [] }}
        allowance={null}
        withId={null}
      />,
    );
    expect(screen.getByText("No rehearsals yet")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-rehearse-pick]") as Element);
    fireEvent.click(screen.getByRole("radio", { name: "Tough" }));
    expect(
      screen
        .getByRole("link", { name: /Start rehearsal/u })
        .getAttribute("href"),
    ).toBe(`/rehearsals/investor/${UUID(20)}?difficulty=TOUGH`);
    cleanup();

    render(
      <RehearsalsHome
        basePath="/rehearsals"
        partners={{
          role: "FOUNDER",
          upcoming: [],
          people: [
            {
              counterpart,
              relationshipId: UUID(40),
              state: "CONNECTED",
              lastRehearsal: null,
            },
          ],
        }}
        history={{ rehearsals: [] }}
        allowance={{
          words: "You've used this month's rehearsals on your Free plan.",
          out: true,
        }}
        withId={null}
      />,
    );
    fireEvent.click(document.querySelector("[data-rehearse-pick]") as Element);
    expect(screen.queryByRole("link", { name: /Start rehearsal/u })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Change plan" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("The Q Daily as a newspaper", () => {
  const story = (id: string, over: Partial<QDailyStory> = {}): QDailyStory => ({
    id,
    section: "YOUR_SECTOR",
    headline: `Headline ${id}`,
    standfirst: "",
    paragraphs: [`Body of ${id}.`],
    quotes: [],
    sources: [
      {
        url: `https://news.example/${id}`,
        publisher: "Example News",
        title: id,
        publishedAt: null,
      },
    ],
    image: null,
    deal: null,
    written: true,
    ...over,
  });
  const edition: QDailyEdition = {
    id: UUID(50),
    number: 41,
    editionDate: "2026-10-20",
    frequency: "DAILY",
    readerName: "Larkfield Robotics",
    topics: ["Northmoor Capital"],
    lead: story("lead"),
    sections: [
      { code: "YOUR_SECTOR", title: "Your sector", stories: [story("s1")] },
      {
        code: "DEALS",
        title: "Deals",
        stories: [
          story("d1", {
            section: "DEALS",
            deal: {
              company: "Pick Systems",
              amount: "$6M",
              amountUsd: 6_000_000,
              round: "seed",
              sourceIndex: 0,
            },
          }),
        ],
      },
    ],
    briefs: [],
    chart: null,
    qTake: {
      paragraphs: ["Your raise sits where seed held up."],
      storyIds: ["lead"],
      truthClass: "Q_INFERENCE",
    },
    generatedAt: "2026-10-20T06:00:00.000Z",
  };

  it("labels Q's take as inference on the story it is about, and says when there is none", () => {
    render(<DailyPaper edition={edition} />);
    expect(
      document.querySelector("[data-daily-lead] [data-daily-take]"),
    ).toBeTruthy();
    expect(screen.getByText("Pick Systems")).toBeTruthy();
    expect(screen.getByText("$6M seed")).toBeTruthy();
    // Following: nothing Q could cite about them, said plainly.
    expect(
      screen.getByText("Nothing new about them that Q could cite"),
    ).toBeTruthy();
    fireEvent.click(
      document.querySelector('[data-daily-story="s1"]') as Element,
    );
    const sheet = document.querySelector("[data-daily-story-sheet]");
    expect(sheet?.textContent).toContain("Q has no take on this one.");
    expect(
      screen
        .getByRole("link", { name: /Read at the source/u })
        .getAttribute("href"),
    ).toBe("https://news.example/s1");
  });

  it("turns the paper on from its off state", async () => {
    vi.mocked(dailyActions.setDailyPreferencesAction).mockResolvedValue({
      ok: true,
      preferences: {
        frequency: "DAILY",
        email: false,
        sections: [],
        nextDueAt: null,
      },
    });
    render(<DailyOff />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
      await Promise.resolve();
    });
    expect(dailyActions.setDailyPreferencesAction).toHaveBeenCalledWith({
      frequency: "DAILY",
    });
    expect(
      await screen.findByText(
        "The Q Daily is on. Your first edition is on its way.",
      ),
    ).toBeTruthy();
  });
});

describe("the main pitch", () => {
  const video = (over: Partial<MediaAssetDto>): MediaAssetDto => ({
    mediaAssetId: UUID(60),
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 184,
    aspectRatio: "16:9",
    playbackPolicy: "AUTHORISED",
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    title: "Seed pitch",
    audience: "NETWORK",
    downloadable: false,
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-10-12T09:00:00.000Z",
    readyAt: "2026-10-12T09:05:00.000Z",
    version: 3,
    ...over,
  });

  it("shows chapters from Q's reading, and who can watch in words", async () => {
    render(
      <PitchMain
        companyId={UUID(61)}
        companyName="Larkfield"
        videos={[
          video({}),
          video({
            mediaAssetId: UUID(62),
            title: "Demo",
            playbackPolicy: "PRIVATE",
            createdAt: "2026-10-01T00:00:00.000Z",
          }),
        ]}
        sections={[
          {
            sectionKey: "problem",
            label: "Problem",
            value: "Picking is slow",
            pitchId: UUID(60),
            pitchTitle: "Seed pitch",
            atSeconds: 0,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            source: "PITCH_VIDEO",
          },
          {
            sectionKey: "ask",
            label: "Raise",
            value: "$2.5M seed",
            pitchId: UUID(60),
            pitchTitle: "Seed pitch",
            atSeconds: 160,
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            source: "PITCH_VIDEO",
          },
        ]}
      />,
    );
    const chapters = within(
      screen.getByRole("list", { name: "Chapters" }),
    ).getAllByRole("button");
    expect(chapters.map((chapter) => chapter.textContent)).toEqual([
      "0:00The Problem",
      "2:40Our Ask",
    ]);
    expect(screen.getAllByText("Everyone on Capital Q").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Private, Only your team")).toBeTruthy();
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-heard-state="SAID"]'),
      ).toHaveLength(2),
    );
    expect(screen.getAllByText("Your claim, said in the pitch")).toHaveLength(
      2,
    );
  });

  it("says why a pitch has no chapters", () => {
    render(
      <PitchMain
        companyId={UUID(61)}
        companyName={null}
        videos={[video({ transcriptState: "NOT_REQUESTED" })]}
        sections={[]}
      />,
    );
    expect(
      document.querySelector("[data-chapters-empty]")?.textContent,
    ).toMatch(/no transcript/u);
    expect(pitchActions.setPitchDetailsAction).not.toHaveBeenCalled();
  });

  it("offers an upload when there is no video", () => {
    render(
      <PitchMain
        companyId={UUID(61)}
        companyName={null}
        videos={[]}
        sections={null}
      />,
    );
    expect(screen.getByText("No pitch video yet")).toBeTruthy();
  });
});

describe("the data room as folders", () => {
  it("opens a folder with its documents and who can open it, and withdraws in one tap", async () => {
    vi.mocked(requestActions.loadFolderAccessAction).mockResolvedValue({
      ok: true,
      value: {
        folderCode: "financials",
        label: "Financials",
        documents: [],
        investors: [],
        candidates: [
          {
            relationshipId: UUID(72),
            investorOrganisationName: "Ellery Partners",
          },
        ],
        awaitingConnection: [],
      },
    });
    vi.mocked(requestActions.loadDocumentAccessAction).mockResolvedValue({
      ok: true,
      value: {
        documentId: UUID(70),
        title: "Unit economics",
        folderCode: "financials",
        level: "ON_REQUEST",
        visibilityScope: "specifically_shared",
        version: 1,
        grants: [
          {
            policyId: UUID(73),
            relationshipId: UUID(71),
            investorOrganisationName: "Northmoor Capital",
            accessLevel: "view",
            grantedAt: "2026-10-01T00:00:00.000Z",
            expiresAt: "2026-11-12T00:00:00.000Z",
          },
        ],
        history: [],
        candidates: [],
        awaitingConnection: [],
      },
    });
    render(
      <DataRoomTab
        companyId={UUID(74)}
        items={[]}
        view={{
          viewer: "OWNER",
          companyId: UUID(74),
          stageCode: "seed",
          countryCode: null,
          folders: [{ code: "financials", label: "Financials" }],
          documents: [
            {
              documentId: UUID(70),
              title: "Unit economics",
              folderCode: "financials",
              checklistItemCode: null,
              level: "ON_REQUEST",
              visibilityScope: "specifically_shared",
              kind: "Sheet",
              pageCount: null,
              updatedAt: "2026-10-01T00:00:00.000Z",
              validUntil: null,
              sharedWith: 1,
              openedBy: 0,
              version: 1,
            },
          ],
          checklist: [],
          requests: [],
        }}
      />,
    );
    const card = document.querySelector('[data-folder="financials"]');
    expect(card?.textContent).toContain("On request");
    fireEvent.click(card as Element);
    expect(await screen.findByText("Northmoor Capital")).toBeTruthy();
    expect(screen.getByText("View only until 12 Nov")).toBeTruthy();
    expect(screen.getByText("Connected, not shared")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
      await Promise.resolve();
    });
    expect(requestActions.revokeAccessAction).toHaveBeenCalledWith(UUID(73));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await Promise.resolve();
    });
    expect(requestActions.shareFolderAction).toHaveBeenCalledWith(
      UUID(74),
      "financials",
      { relationshipId: UUID(72), accessLevel: "view", days: 30 },
    );
  });
});
