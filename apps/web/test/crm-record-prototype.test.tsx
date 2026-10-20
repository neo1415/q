// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DealViewDto,
  MeetingDto,
  RelationshipBrief,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

/**
 * The relationship record as the CRM prototypes drew it (2026-10-20): the
 * logic each design added, asserted by code -- approval bound to the exact
 * terms (an edit asks for revision 2), the week's hours, the checklist's
 * counts, the inbox order, and a not-proceeding note sent only as approved.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/relationships",
}));

const recordTerms = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../src/features/relationships/deal-actions", () => ({
  readDealAction: vi.fn(),
  recordTermsAction: (...args: unknown[]) => recordTerms(...args),
  markSignedAction: vi.fn(),
  closeDealAction: vi.fn(),
  tickChecklistAction: vi.fn(),
  generateReportAction: vi.fn(),
}));
const pass = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../src/features/relationships/outcome-actions", () => ({
  passAction: (...args: unknown[]) => pass(...args),
  pauseAction: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
  resumeAction: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
  passReasonsAction: () => Promise.resolve({ ok: true, value: { items: [] } }),
  readPassAction: vi.fn(),
  meetingOutcomeAction: vi.fn(),
}));
vi.mock("../src/features/schedule/schedule-actions", () => ({
  bookMeetingAction: vi.fn(),
  cancelMeetingAction: vi.fn(),
  meetingBriefAction: vi.fn(),
  weekAvailabilityAction: vi.fn(),
}));
vi.mock("../src/features/schedule/meeting-q", () => ({ MeetingQ: () => null }));
vi.mock("@/features/relationships/diligence-actions", () => ({}));
vi.mock("@/features/onboarding-kit/material-actions", () => ({}));
vi.mock("@/features/chat/chat-actions", () => ({}));
vi.mock("@/features/fit/fit-actions", () => ({}));
vi.mock("@/features/documents/not-scanned-note", () => ({
  NotScannedNote: () => null,
}));

const { RelationshipDeal, changedFields, termsApprovalKey } =
  await import("../src/features/relationships/relationship-deal");
const { slotKind, weekStart } =
  await import("../src/features/schedule/calls-week");
const { checklistCounts, openQuestionsNotAsked } =
  await import("../src/features/relationships/relationship-diligence");
const { DecisionChoice } =
  await import("../src/features/relationships/decision-choice");

afterEach(() => {
  cleanup();
  recordTerms.mockReset();
  pass.mockReset();
});

const REL = "00000000-0000-4000-8000-000000000101";
const at = "2026-10-20T10:00:00.000Z";

function dealView(terms: DealViewDto["terms"]): DealViewDto {
  return {
    relationshipId: REL,
    side: "INVESTOR",
    stageVersion: "deal-stage.v1",
    stages: (
      [
        "MET",
        "DILIGENCE",
        "SOFT_COMMIT",
        "TERMS",
        "SIGNED",
        "FUNDS_RECEIVED",
        "CLOSED",
      ] as const
    ).map((stage, index) => ({
      stage,
      reachedAt: index < 3 ? at : null,
    })),
    current: "SOFT_COMMIT",
    end: null,
    nextSteps: ["RECORD_TERMS"],
    terms,
    termsHistory: [],
    close: null,
    checklist: [],
    updateCadence: null,
    passNoteDraft: null,
    sharedDocumentIds: [],
    reports: [],
  };
}

const recorded: NonNullable<DealViewDto["terms"]> = {
  termsId: "00000000-0000-4000-8000-000000000201",
  version: 1,
  status: "RECORDED",
  instrument: "SAFE",
  amount: "250000",
  currencyCode: "USD",
  valuationCap: "24000000",
  valuationBasis: "POST_MONEY",
  preMoneyValuation: null,
  discountPercent: null,
  proRata: true,
  otherTerms: null,
  termsDocumentId: null,
  recordedBySide: "INVESTOR",
  recordedBy: null,
  recordedAt: at,
  signedDocumentId: null,
  signedBy: null,
  signedAt: null,
};

describe("terms beside what gets recorded (deal option 2)", () => {
  it("binds the approval key to the exact payload", () => {
    const a = {
      instrument: "SAFE" as const,
      amount: "250000",
      currencyCode: "USD",
    };
    expect(termsApprovalKey("n1", a)).toBe(termsApprovalKey("n1", { ...a }));
    expect(termsApprovalKey("n1", a)).not.toBe(
      termsApprovalKey("n1", { ...a, amount: "260000" }),
    );
    expect(termsApprovalKey("n1", a)).toMatch(/^[A-Za-z0-9:_-]{8,200}$/u);
  });

  it("names only what changed against the recorded version", () => {
    const same = {
      instrument: "SAFE" as const,
      amount: "250000.00",
      currencyCode: "USD",
      valuationCap: "24000000",
      valuationBasis: "POST_MONEY" as const,
      proRata: true,
    };
    expect([...changedFields(same, recorded)]).toEqual([]);
    expect([
      ...changedFields({ ...same, valuationCap: "22000000" }, recorded),
    ]).toEqual(["cap"]);
    expect(changedFields(same, null).size).toBe(0);
  });

  it("shows approval, then asks for revision 2 once the cap changes", async () => {
    recordTerms.mockResolvedValue({ ok: true, value: dealView(recorded) });
    render(
      <RelationshipDeal
        relationshipId={REL}
        counterpart="Tessellate Labs"
        side="INVESTOR"
        initial={dealView(recorded)}
      />,
    );
    expect(
      document.querySelector("[data-terms-state=approved]")?.textContent,
    ).toContain("as shown above");
    expect(screen.getByRole("button", { name: "Recorded" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.change(screen.getByLabelText("Post-money cap"), {
      target: { value: "22000000" },
    });
    expect(
      document.querySelector("[data-terms-state=stale]")?.textContent,
    ).toContain("revision 2");
    expect(document.querySelector("[data-changed=yes]")?.textContent).toContain(
      "$22,000,000",
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Approve revision 2" }),
      );
      await Promise.resolve();
    });
    expect(recordTerms).toHaveBeenCalledTimes(1);
    const [id, terms, key] = recordTerms.mock.calls[0] ?? [];
    expect(id).toBe(REL);
    expect(terms).toMatchObject({
      instrument: "SAFE",
      valuationCap: "22000000",
      valuationBasis: "POST_MONEY",
      proRata: true,
    });
    expect(String(key)).toMatch(/^web-deal-terms-/u);
  });
});

const meeting = (startsAt: string, endsAt: string): MeetingDto => ({
  id: "00000000-0000-4000-8000-000000000301",
  relationshipId: REL,
  purpose: "Second call",
  startsAt,
  endsAt,
  timeZone: "UTC",
  status: "SCHEDULED",
  organisedByYou: true,
  organiserName: "You",
  meetLink: null,
  attendees: [],
  hasBrief: false,
});

describe("calls on the week (calls option 2)", () => {
  it("starts on Monday, and on a weekend shows the next week", () => {
    expect(weekStart(new Date(2026, 9, 22)).getDay()).toBe(1);
    expect(weekStart(new Date(2026, 9, 22)).getDate()).toBe(19);
    expect(weekStart(new Date(2026, 9, 25)).getDate()).toBe(26);
    expect(weekStart(new Date(2026, 9, 22), 1).getDate()).toBe(26);
  });

  it("is booked, busy, past or free, in that order of truth", () => {
    const hour = 3_600_000;
    const start = Date.parse("2026-10-21T14:00:00.000Z");
    const now = start - 24 * hour;
    const booked = [
      meeting("2026-10-21T14:00:00.000Z", "2026-10-21T14:45:00.000Z"),
    ];
    expect(slotKind(start, start + hour, booked, [], now).kind).toBe("booked");
    expect(
      slotKind(start, start + hour, [], [{ start, end: start + hour }], now)
        .kind,
    ).toBe("busy");
    expect(slotKind(start, start + hour, [], [], now).kind).toBe("free");
    // Unread calendar: an hour is never offered as free.
    expect(slotKind(start, start + hour, [], null, now).kind).toBe("past");
    expect(slotKind(start, start + hour, [], [], start + hour).kind).toBe(
      "past",
    );
  });
});

describe("the request checklist (diligence option 1)", () => {
  it("counts shared, waiting and not asked from the real area", () => {
    const doc = "00000000-0000-4000-8000-000000000401";
    const area = {
      requests: [
        {
          requestId: "00000000-0000-4000-8000-000000000402",
          title: "Tax filings",
          note: null,
          requestedAt: at,
          requestedByName: null,
          status: "FULFILLED" as const,
          declineNote: null,
          fulfilledBy: { documentId: doc, title: "Tax filings" },
          questions: null,
        },
        {
          requestId: "00000000-0000-4000-8000-000000000403",
          title: "IP assignment deeds",
          note: null,
          requestedAt: at,
          requestedByName: null,
          status: "OPEN" as const,
          declineNote: null,
          fulfilledBy: null,
          questions: null,
        },
      ],
      shares: [
        {
          policyId: "00000000-0000-4000-8000-000000000404",
          documentId: doc,
          title: "Tax filings",
          documentType: "TAX",
          sharedAt: at,
          scanned: true,
          viewedAt: null,
          qSummary: null,
        },
      ],
    };
    expect(checklistCounts(area, 1)).toEqual({
      shared: 1,
      waiting: 1,
      notAsked: 1,
      answered: 1,
      asked: 2,
    });
    expect(
      openQuestionsNotAsked(
        ["ip assignment deeds", "Retention by customer", " "],
        area.requests,
      ),
    ).toEqual(["Retention by customer"]);
  });
});

describe("the inbox split (messages option 3)", () => {
  it("puts the newest conversation first and locks one not yet connected", async () => {
    const { inboxRows } =
      await import("../src/features/relationships/inbox-rows");
    const item = (
      id: string,
      name: string,
      state: RelationshipSummaryDto["state"],
      since: string,
    ): RelationshipSummaryDto => ({
      relationshipId: id,
      counterpart: { kind: "COMPANY", id, name },
      state,
      stateSince: since,
      nextStep: "FOLLOW_UP",
    });
    const brief = {
      messages: {
        count: 3,
        latest: {
          status: "OK",
          message: {
            from: "THEM",
            senderName: "Dev Patel",
            preview: "Ahead of the call",
            sentAt: "2026-10-20T08:55:00.000Z",
          },
          fromThem: null,
        },
      },
    } as unknown as RelationshipBrief;
    const rows = inboxRows(
      [
        item(
          "00000000-0000-4000-8000-000000000501",
          "Lumenfold",
          "INTEREST_EXPRESSED",
          "2026-10-08T09:00:00.000Z",
        ),
        item(
          "00000000-0000-4000-8000-000000000502",
          "Tessellate Labs",
          "IN_DILIGENCE",
          "2026-10-19T09:00:00.000Z",
        ),
      ],
      new Map([["00000000-0000-4000-8000-000000000502", brief]]),
      new Map([["00000000-0000-4000-8000-000000000502", 1]]),
    );
    expect(rows.map((row) => row.name)).toEqual([
      "Tessellate Labs",
      "Lumenfold",
    ]);
    expect(rows[0]).toMatchObject({
      matched: true,
      unread: 1,
      preview: "Dev Patel: Ahead of the call",
      href: "/relationships/company/00000000-0000-4000-8000-000000000502/messages",
    });
    expect(rows[1]?.matched).toBe(false);
    expect(rows[1]?.preview).toMatch(/^Interest sent /u);
  });
});

describe("the record's Decision (record option 3)", () => {
  it("sends a not-proceeding note only as approved, under a key for that text", async () => {
    pass.mockResolvedValue({ ok: true, value: {} });
    render(
      <DecisionChoice
        relationshipId={REL}
        state="IN_DILIGENCE"
        counterpart="Tessellate Labs"
      />,
    );
    expect(
      screen
        .getByRole("radio", { name: /Keep going/u })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /Not proceeding/u }));
    const note = await screen.findByLabelText("Draft note, for you to edit");
    expect(pass).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: "Not for now, thank you." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
      await Promise.resolve();
    });
    expect(pass).toHaveBeenCalledWith(
      REL,
      {
        reasonCode: null,
        note: "Not for now, thank you.",
        shareWithFounder: true,
      },
      expect.stringMatching(/^web-pass-/u),
    );
  });
});
