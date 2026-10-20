// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Profile option 1, the decision brief (owner 2026-10-20): the next step's
 * journey from real relationship state and real gaps, the data room's own
 * steps, the key numbers, Q's drafted questions, the Diligence ledger, and
 * the section-by-section track (arrows, keys, the strip). Pure logic is
 * tested without a screen; nothing here sends anything.
 */

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({
    open: false,
    setOpen: () => undefined,
    askAbout: () => undefined,
    askNow: () => undefined,
  }),
}));

const { journeyFor, callMoment } =
  await import("../src/features/company/brief/journey");
const { keyNumbers, headerRaise } =
  await import("../src/features/company/brief/model");
const { draftsFromBoard } =
  await import("../src/features/company/brief/brief-context");
const { diligenceLedger, ledgerCounts } =
  await import("../src/features/company/brief/diligence-model");
const { roomSteps } =
  await import("../src/features/company/material/data-room");
const { SectionTrack } =
  await import("../src/features/company/brief/section-track");
const { nextCallOf } = await import("../src/features/company/brief/next-step");
const fixtures =
  await import("../src/features/company/material/review-fixtures");
const { pitchProfileSections } =
  await import("../src/features/company/pitch-profile");

afterEach(cleanup);

const BASE = {
  companyName: "Kora Health",
  founderName: "Amara Okafor",
  state: "IN_DILIGENCE" as const,
  connected: true,
  drafts: [{ topic: "Lead investor" }, { topic: "Retention" }],
  waiting: 0,
  requestable: ["Signed SAFEs", "Trademark registration"],
  requested: 0,
  nextCall: null,
  met: false,
};

describe("the next-step journey", () => {
  it("starts with the questions, naming the gaps they close", () => {
    const journey = journeyFor(BASE);
    expect(journey?.now).toBe(0);
    const step = journey?.steps[0];
    expect(step?.kind).toBe("ASK");
    expect(step?.mark).toBe("NOW");
    expect(step?.title).toBe("Send 2 questions to Amara Okafor");
    expect(step?.reason).toContain("lead investor and retention");
    expect(journey?.steps.map((s) => s.kind)).toEqual([
      "ASK",
      "DOCUMENTS",
      "CALL",
      "DECIDE",
    ]);
  });

  it("moves to the documents once the questions are sent, then the call", () => {
    const sent = journeyFor({ ...BASE, drafts: [], waiting: 2 });
    expect(sent?.steps[0]?.mark).toBe("DONE");
    expect(sent?.steps[sent.now]?.kind).toBe("DOCUMENTS");
    expect(sent?.steps[sent.now]?.action).toBe("Request 2 documents");
    const call = journeyFor({
      ...BASE,
      drafts: [],
      requestable: [],
      nextCall: {
        startsAt: "2030-10-21T13:00:00.000Z",
        timeZone: "Africa/Lagos",
        hasBrief: true,
      },
    });
    expect(call?.steps[call.now]?.title).toBe(
      "Prepare for your call on 21 Oct, 14:00",
    );
    expect(call?.steps[call.now]?.action).toBe("Open call brief");
  });

  it("before the founders accept, offers Express interest and nothing that sends", () => {
    const journey = journeyFor({
      ...BASE,
      state: null,
      connected: false,
    });
    expect(journey?.steps[0]?.kind).toBe("CONNECT");
    expect(journey?.steps[0]?.action).toBe("Express interest");
    expect(
      journey?.steps.slice(1).every((step) => step.mark === "LATER"),
    ).toBe(true);
    const pending = journeyFor({
      ...BASE,
      state: "INTEREST_EXPRESSED",
      connected: false,
    });
    expect(pending?.steps[0]?.action).toBeNull();
  });

  it("offers nothing on a closed relationship", () => {
    expect(journeyFor({ ...BASE, state: "PASSED" })).toBeNull();
    expect(journeyFor({ ...BASE, state: "INVESTED" })).toBeNull();
  });

  it("says a call's time in its own time zone, and picks the next one booked", () => {
    expect(callMoment("2030-10-21T13:00:00.000Z", "Africa/Lagos")).toBe(
      "21 Oct, 14:00",
    );
    const meetings = fixtures.reviewMeetings();
    expect(nextCallOf(meetings, Date.parse("2030-01-01"))?.hasBrief).toBe(
      true,
    );
    expect(nextCallOf(meetings, Date.parse("2031-01-01"))).toBeNull();
    expect(
      nextCallOf(
        [{ ...meetings[0]!, status: "CANCELLED" }],
        Date.parse("2030-01-01"),
      ),
    ).toBeNull();
  });
});

describe("the data room's next step (data room option 1)", () => {
  it("asks for what is on request first, then the time-limited read, then Q", () => {
    const room = fixtures.reviewInvestorRoom();
    const now = Date.parse("2026-10-20T09:00:00.000Z");
    const steps = roomSteps({
      companyName: "Kora Health",
      documents: room.documents,
      now,
    });
    expect(steps.map((s) => s.key)).toEqual(["REQUEST", "READ", "ASK"]);
    expect(steps[0]?.title).toBe("Request the 5 documents on request");
    expect(steps[0]?.action).toBe("Request all");
    expect(steps[1]?.title).toBe(
      "Read Shareholders and directors register before 12 Nov",
    );
    expect(steps[1]?.reason).toContain("23 more days");
    const none = roomSteps({
      companyName: "Kora Health",
      documents: room.documents.filter((d) => d.access !== "REQUESTABLE"),
      now,
    });
    expect(none[0]?.done).toBe(true);
  });
});

describe("the key numbers and the header's raise", () => {
  const deck = fixtures.reviewDeck("INVESTOR").extraction?.sections ?? null;

  it("shows only what the deck states, the round first", () => {
    const numbers = keyNumbers({ deck, raise: null });
    expect(numbers.map((n) => `${n.label} ${n.value}`)).toEqual([
      "Raising $1.5m",
      "Valuation cap $12m",
      "Minimum cheque $50k",
      "Monthly revenue $41k",
      "Clinics live 140",
      "Runway 20 months",
    ]);
    expect(keyNumbers({ deck: null, raise: null })).toEqual([]);
  });

  it("names where the header's raise comes from, as the founder's claim", () => {
    const raise = headerRaise({
      profile: fixtures.reviewProfile("INVESTOR"),
      own: false,
      deck,
    });
    expect(raise.words).toBe("$750K safe, $12m cap");
    expect(raise.source).toContain("Pitch video at 0:41");
    expect(raise.source).toContain("Not verified");
  });
});

describe("Q's drafted questions", () => {
  it("drafts the unknowns first, never the asked ones or the evidenced", () => {
    const drafts = draftsFromBoard(fixtures.reviewBoard(), []);
    expect(drafts.map((d) => d.topic)).toEqual([
      "Lead investor",
      "Retention",
      "Market source",
    ]);
    expect(drafts.every((d) => d.about !== null)).toBe(true);
  });

  it("falls back to Q's open questions when there is no board", () => {
    const drafts = draftsFromBoard(null, ["Does the round need a lead?"]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.from).toBe("Q");
  });
});

describe("the Diligence ledger", () => {
  it("labels every fact and never turns an unknown into a zero", () => {
    const profile = fixtures.reviewProfile("INVESTOR");
    const deckView = fixtures.reviewDeck("INVESTOR");
    const sections = pitchProfileSections({
      companyName: "Kora Health",
      own: false,
      deckSections: deckView.extraction?.sections ?? null,
      pitchClaims: profile.overview?.pitchClaims ?? [],
      answers: {
        shortDescription: profile.shortDescription,
        sectorLabels: [],
        team: profile.overview?.team ?? [],
        raise: null,
      },
    });
    const folds = diligenceLedger({
      profile,
      own: false,
      sectorLabels: [],
      deck: deckView.extraction?.sections ?? null,
      sections,
      board: fixtures.reviewBoard(),
      sharedInDiligence: [],
      verified: true,
    });
    expect(folds.map((f) => f.id)).toEqual([
      "company-raise",
      "company-traction",
      "company-team",
      "company-market",
      "company-unknowns",
      "company-details",
    ]);
    const rows = folds.flatMap((f) => f.rows);
    for (const row of rows) {
      if (row.value === null) expect(row.evidence).toBe("unk");
      expect(row.value).not.toBe("0");
    }
    const counts = ledgerCounts(folds);
    expect(counts.unknown).toBeGreaterThan(0);
    expect(counts.doc + counts.claim + counts.unknown).toBeLessThanOrEqual(
      counts.marks.length,
    );
    // A pitch figure with no round shared reads as a claim, never verified.
    expect(folds[0]?.rows[0]).toMatchObject({
      label: "Raising",
      evidence: "claim",
      where: "Pitch video, 0:41",
    });
  });
});

describe("the section-by-section track", () => {
  it("moves with the strip, the arrows and the arrow keys, and says where it is", () => {
    const sections = [
      { key: "problem", label: "Problem", gap: false },
      { key: "moats", label: "Moats", gap: true },
      { key: "ask", label: "The ask", gap: false },
    ];
    const seen: number[] = [];
    render(
      <SectionTrack
        sections={sections}
        label="Sections"
        onIndex={(at) => seen.push(at)}
        render={(at) => <p>{sections[at]?.label} detail</p>}
      />,
    );
    expect(screen.getByText("1 of 3 · Problem")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Previous section" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(screen.getByText("2 of 3 · Moats")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Moats, not provided" })
        .getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByRole("region", { name: "Sections" }), {
      key: "ArrowRight",
    });
    expect(screen.getByText("3 of 3 · The ask")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Problem" }));
    expect(screen.getByText("1 of 3 · Problem")).toBeTruthy();
    expect(seen).toEqual([1, 2, 0]);
    // Every section stays in the page, for Q and assistive tech.
    expect(document.querySelectorAll("[data-profile-section]")).toHaveLength(3);
  });
});
