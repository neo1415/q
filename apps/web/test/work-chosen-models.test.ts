import { describe, expect, it } from "vitest";

import type {
  DataRoomOwnerView,
  DocumentAccessDto,
  MediaAssetDto,
  OnboardingSessionView,
  PitchSectionFactDto,
  QRehearsalSummaryDto,
  QWorkReportDto,
} from "@capital-q/contracts";

import {
  dayTitle,
  editionsByDate,
  isDate,
  isMonth,
  monthDays,
  monthEnd,
  shiftMonth,
} from "../src/features/daily/daily-calendar-model";
import {
  accessWords,
  folderCards,
  folderPeople,
  sharedWords,
} from "../src/features/documents/requests/data-room-folders-model";
import { translate } from "../src/features/i18n/messages";
import {
  chapterAt,
  chaptersOf,
  heardState,
  mainPitch,
  noChaptersReason,
  sectionsOf,
} from "../src/features/pitch/pitch-chapters";
import {
  bestMatch,
  momentTurn,
} from "../src/features/rehearsal/review-moments";
import {
  outOfTen,
  pastState,
  withDifficulty,
} from "../src/features/rehearsal/rehearsals-home";
import {
  draftFor,
  findingRows,
  stepBlocked,
  stepOrder,
} from "../src/features/work/report-steps";

/**
 * The chosen Work designs' logic (2026-10-21), tested without a browser:
 * the report's prepared steps, the data room's folders, the pitch's
 * chapters, the rehearsal states and the edition calendar. Nothing here
 * invents a value the server did not send.
 */

const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const report: QWorkReportDto = {
  counterpartName: "Pellucid Health",
  writtenAt: "2026-10-19T10:00:00.000Z",
  headline: "Paying NHS customers, runway unknown",
  howItWent: "Sam answered every question.",
  strengths: [
    { point: "Paying customers in three NHS trusts", basis: "CLAIM" },
  ],
  concerns: [
    { point: "Sales cycles may run past 12 months", basis: "INFERENCE" },
    { point: "Runway", basis: "CLAIM" },
  ],
  openQuestions: [
    "How long did each NHS contract take?",
    "What is your runway today?",
  ],
  recommendation: "PROCEED",
  why: "Paying customers match your instruction.",
  interview: [
    {
      question: "Who pays you today?",
      answer:
        "We have paying contracts with three NHS trusts in the North West.",
      byQ: false,
    },
    {
      question: "How long are sales cycles?",
      answer: "Procurement varies a lot by trust.",
      byQ: false,
    },
  ],
  relationshipId: UUID(1),
  companyId: UUID(2),
  laneOpen: true,
};

describe("the first-stage report's prepared next steps", () => {
  it("offers Q's recommended step first, never deciding for the person", () => {
    expect(stepOrder("PROCEED")[0]).toBe("CALL");
    expect(stepOrder("MAYBE")[0]).toBe("QUESTIONS");
    expect(stepOrder("PASS")[0]).toBe("PASS");
    expect([...stepOrder("PASS")].sort()).toEqual([
      "CALL",
      "PASS",
      "QUESTIONS",
    ]);
  });

  it("drafts each message from the report's own words", () => {
    expect(draftFor("CALL", report)).toContain(
      "sales cycles may run past 12 months, and runway",
    );
    const questions = draftFor("QUESTIONS", report);
    expect(questions).toContain("1. How long did each NHS contract take?");
    expect(questions).toContain("2. What is your runway today?");
    expect(draftFor("PASS", report)).toMatch(/isn’t the right fit/u);
  });

  it("blocks a step that cannot be sent, and says why", () => {
    expect(stepBlocked("CALL", report)).toBeNull();
    expect(stepBlocked("CALL", { ...report, relationshipId: null })).toMatch(
      /no conversation/u,
    );
    expect(stepBlocked("QUESTIONS", { ...report, openQuestions: [] })).toMatch(
      /no open questions/u,
    );
  });

  it("locates a claim at the answer it was said in, and an inference as Q's reading", () => {
    const rows = findingRows(report);
    expect(rows.map((row) => row.kind)).toEqual([
      "Strength",
      "Concern",
      "Concern",
    ]);
    expect(rows[0]?.where).toBe("Said in answer 1");
    expect(rows[1]?.where).toMatch(/^Q’s reading/u);
    // One word in common is no location: it stays "in the interview".
    expect(rows[2]?.where).toBe("Said in the interview");
  });
});

describe("tying a note to the transcript", () => {
  const turns = [
    {
      from: "THEM" as const,
      text: "How does retention look?",
      at: "2026-10-01T10:00:00Z",
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU" as const,
      text: "We’re raising a few million to hire two enterprise sellers.",
      at: "2026-10-01T10:01:00Z",
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU" as const,
      text: "Both renewed.",
      at: "2026-10-01T10:02:00Z",
      mood: null,
      sawScreen: false,
    },
  ];

  it("finds the person's line that shares most of the moment's words", () => {
    expect(momentTurn("The ask was vague: raising a few million", turns)).toBe(
      1,
    );
  });

  it("points nowhere when the match is weak", () => {
    expect(momentTurn("Spoke too fast overall", turns)).toBeNull();
    expect(bestMatch("Anything", [])).toBeNull();
  });
});

describe("the data room as folders", () => {
  const doc = (
    n: number,
    folderCode: string,
    level: "PUBLIC" | "ON_REQUEST" | "PRIVATE",
  ) => ({
    documentId: UUID(n),
    title: `Doc ${String(n)}`,
    folderCode,
    checklistItemCode: null,
    level,
    visibilityScope:
      level === "PUBLIC"
        ? ("network_visible" as const)
        : level === "PRIVATE"
          ? ("organisation_private" as const)
          : ("specifically_shared" as const),
    kind: "PDF",
    pageCount: 4,
    updatedAt: "2026-10-01T00:00:00.000Z",
    validUntil: null,
    sharedWith: 0,
    openedBy: 0,
    version: 1,
  });
  const view: DataRoomOwnerView = {
    viewer: "OWNER",
    companyId: UUID(9),
    stageCode: "seed",
    countryCode: "GB",
    folders: [
      { code: "fundraising", label: "Fundraising" },
      { code: "financials", label: "Financials" },
      { code: "legal", label: "Legal and IP" },
    ],
    documents: [
      doc(1, "fundraising", "PUBLIC"),
      doc(2, "financials", "ON_REQUEST"),
      doc(3, "financials", "PRIVATE"),
    ],
    checklist: [
      {
        code: "cap_table",
        folderCode: "legal",
        label: "Cap table",
        defaultLevel: "ON_REQUEST",
        present: false,
      },
    ],
    requests: [
      {
        requestId: UUID(20),
        relationshipId: UUID(31),
        documentId: UUID(2),
        documentTitle: "Doc 2",
        requesterName: "Jo Ashby",
        requesterOrganisationName: "Sable Fund",
        note: null,
        requestedAt: "2026-10-17T00:00:00.000Z",
        status: "OPEN",
        accessEndsAt: null,
      },
    ],
  };

  it("says in words who can open each folder, from its documents' levels", () => {
    const cards = folderCards(view);
    expect(cards.map((card) => accessWords(card.access))).toEqual([
      "Capital Q members",
      "Mixed: on request, only your team",
      "Nothing filed yet",
    ]);
    expect(cards[2]?.missing).toEqual(["Cap table"]);
  });

  it("lists who has access, who asked, who is connected, and who waits", () => {
    const access: DocumentAccessDto = {
      documentId: UUID(2),
      title: "Doc 2",
      folderCode: "financials",
      level: "ON_REQUEST",
      visibilityScope: "specifically_shared",
      version: 1,
      grants: [
        {
          policyId: UUID(40),
          relationshipId: UUID(30),
          investorOrganisationName: "Northmoor Capital",
          accessLevel: "view",
          grantedAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-11-12T00:00:00.000Z",
        },
      ],
      history: [],
      candidates: [],
      awaitingConnection: [],
    };
    const people = folderPeople({
      folderDocumentIds: [UUID(2), UUID(3)],
      access: [access],
      requests: view.requests,
      candidates: [
        {
          relationshipId: UUID(30),
          investorOrganisationName: "Northmoor Capital",
        },
        {
          relationshipId: UUID(32),
          investorOrganisationName: "Ellery Partners",
        },
      ],
      awaiting: [
        { relationshipId: UUID(33), investorOrganisationName: "Lark Fund" },
      ],
    });
    expect(people.map((person) => [person.kind, person.name])).toEqual([
      ["SHARED", "Northmoor Capital"],
      ["ASKED", "Sable Fund"],
      ["CONNECTED", "Ellery Partners"],
      ["AWAITING", "Lark Fund"],
    ]);
    const shared = people[0];
    if (shared?.kind !== "SHARED") throw new Error("shared");
    expect(shared.policyIds).toEqual([UUID(40)]);
    expect(sharedWords(shared, 2)).toBe("View only until 12 Nov, 1 of 2");
  });
});

describe("the main pitch's chapters", () => {
  const fact = (
    sectionKey: string,
    label: string,
    at: number,
    pitchId = UUID(1),
  ): PitchSectionFactDto => ({
    sectionKey,
    label,
    value: `${label} value`,
    pitchId,
    pitchTitle: "Seed pitch",
    atSeconds: at,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "PITCH_VIDEO",
  });
  const facts = [
    fact("problem", "Problem", 5),
    fact("business_model", "Pricing", 94),
    fact("business_model", "Pilots", 90),
    fact("opportunity", "Market", 90),
    fact("problem", "Other pitch", 1, UUID(2)),
    fact("closing", "Close", 400),
  ];

  it("starts each chapter where its part is first said, inside the video", () => {
    const chapters = chaptersOf(facts, UUID(1), 200);
    expect(chapters.map((chapter) => [chapter.label, chapter.start])).toEqual([
      ["The Problem", 5],
      ["Business Model", 90],
    ]);
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 120)).toBe(1);
  });

  it("groups what Q heard by part, only from this pitch", () => {
    const sections = sectionsOf(facts, UUID(1));
    expect(sections.map((section) => section.sectionKey)).toEqual([
      "problem",
      "business_model",
      "opportunity",
      "closing",
    ]);
    expect(sections[1]?.facts.map((entry) => entry.label)).toEqual([
      "Pilots",
      "Pricing",
    ]);
  });

  it("says why there are no chapters instead of inventing any", () => {
    const video: Pick<MediaAssetDto, "status" | "transcriptState"> = {
      status: "READY",
      transcriptState: "NOT_REQUESTED",
    };
    expect(noChaptersReason(video, false)).toMatch(/no transcript/u);
    expect(
      noChaptersReason({ ...video, transcriptState: "AVAILABLE" }, false),
    ).toMatch(/hasn't read/u);
    expect(noChaptersReason({ ...video, status: "PROCESSING" }, false)).toMatch(
      /once the video is ready/u,
    );
  });

  it("knows a proposal from the pitch waits for the founder's yes", () => {
    const session: Pick<
      OnboardingSessionView,
      "pendingSuggestions" | "responses"
    > = {
      pendingSuggestions: [
        {
          id: UUID(50),
          stepKey: "F9.problem",
          targetField: "problem",
          suggestedValue: { type: "TEXT", text: "Problem: x" },
          confidence: null,
          status: "PENDING",
          createdAt: "2026-10-01T00:00:00.000Z",
          sourceRefs: [{ sourceType: "PITCH_TRANSCRIPT", sourceId: UUID(51) }],
          rationale: null,
        },
      ],
      responses: [],
    };
    expect(heardState("problem", session)).toEqual({
      kind: "PENDING",
      suggestionId: UUID(50),
    });
    expect(heardState("closing", session)).toEqual({ kind: "SAID" });
    expect(heardState("problem", null)).toEqual({ kind: "SAID" });
  });

  it("leads with the newest ready video", () => {
    const video = (
      n: number,
      status: MediaAssetDto["status"],
      createdAt: string,
    ) => ({
      mediaAssetId: UUID(n),
      status,
      live: true,
      purpose: "FOUNDER_PITCH" as const,
      createdAt,
    });
    expect(
      mainPitch([
        video(1, "READY", "2026-10-01T00:00:00Z"),
        video(2, "PROCESSING", "2026-10-05T00:00:00Z"),
        video(3, "READY", "2026-10-03T00:00:00Z"),
      ])?.mediaAssetId,
    ).toBe(UUID(3));
    expect(mainPitch([])).toBeNull();
  });
});

describe("where each past rehearsal stands", () => {
  const item = (over: Partial<QRehearsalSummaryDto>): QRehearsalSummaryDto => ({
    id: UUID(1),
    counterpart: {
      kind: "INVESTOR_ORGANISATION",
      id: UUID(2),
      name: "Northmoor",
    },
    status: "FINISHED",
    outcome: null,
    score: null,
    exchanges: 4,
    createdAt: "2026-10-14T10:00:00.000Z",
    ...over,
  });

  it("names every state the system has", () => {
    expect(pastState(item({ status: "ACTIVE" }))).toBe("IN_PROGRESS");
    expect(pastState(item({ exchanges: 0 }))).toBe("NOTHING_TO_REVIEW");
    expect(pastState(item({}))).toBe("WRITING");
    expect(
      pastState(
        item({
          review: { state: "PROVISIONAL", wentWell: null, workOn: null },
        }),
      ),
    ).toBe("FIRST_NOTES");
    expect(pastState(item({ score: 76 }))).toBe("READY");
  });

  it("writes a 0-100 score out of 10 and carries the chosen difficulty", () => {
    expect(outOfTen(76)).toBe("7.6");
    expect(outOfTen(100)).toBe("10.0");
    expect(withDifficulty("/rehearsals/investor/x", "TOUGH")).toBe(
      "/rehearsals/investor/x?difficulty=TOUGH",
    );
    expect(withDifficulty("/rehearsals/investor/x?meeting=m", "GENTLE")).toBe(
      "/rehearsals/investor/x?meeting=m&difficulty=GENTLE",
    );
    expect(withDifficulty("/rehearsals/investor/x", "REALISTIC")).toBe(
      "/rehearsals/investor/x",
    );
  });
});

describe("the edition calendar", () => {
  it("lays a month out Monday first", () => {
    const days = monthDays("2026-10");
    expect(days).toHaveLength(31);
    // 1 October 2026 is a Thursday.
    expect(days[0]).toEqual({ date: "2026-10-01", day: 1, weekday: 4 });
    expect(days[3]?.weekday).toBe(7);
  });

  it("moves between months and years on calendar dates", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthEnd("2026-02")).toBe("2026-03-01");
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-02-28")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(dayTitle("2026-10-14")).toBe("Wednesday 14 October");
  });

  it("keeps only the month's editions, one per day", () => {
    const byDate = editionsByDate(
      [
        {
          id: UUID(1),
          number: 40,
          editionDate: "2026-10-14",
          frequency: "DAILY",
          headline: null,
        },
        {
          id: UUID(2),
          number: 41,
          editionDate: "2026-10-14",
          frequency: "DAILY",
          headline: "Later",
        },
        {
          id: UUID(3),
          number: 30,
          editionDate: "2026-09-30",
          frequency: "DAILY",
          headline: null,
        },
      ],
      "2026-10",
    );
    expect([...byDate.keys()]).toEqual(["2026-10-14"]);
    expect(byDate.get("2026-10-14")?.number).toBe(41);
  });
});

describe("Arabic for the chosen Work pages' sentences", () => {
  it.each([
    "Your rehearsal with Mina Castell",
    "Rehearse with Northmoor Capital",
    "Rehearsed 14 Oct",
    "No edition on Tuesday 14 October",
    "Said in answer 2",
    "View only until 12 Nov",
    "First-stage report, 19 Oct 2026",
    "Prepared, needs your yes",
  ])("translates %s", (english) => {
    expect(translate("ar", english)).not.toBe(english);
  });
});
