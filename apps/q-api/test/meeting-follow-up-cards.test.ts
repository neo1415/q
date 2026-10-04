import { describe, expect, it } from "vitest";

import type { MeetingNextStepNote } from "@capital-q/communication";

import {
  FOLLOW_UP_CARDS_MAX,
  followUpCards,
  recapMessage,
  callRequestStep,
} from "../src/composition/meeting-follow-up-cards.js";

/**
 * meet-47: after the call, each person gets their own approval cards from
 * what both sides agreed. Code builds them from declared actions; the
 * model only said what kind of step each was.
 */
const REL = "00000000-0000-4000-8000-0000000000e1";
const MEETING = "00000000-0000-4000-8000-0000000000b1";
const DECK = "00000000-0000-4000-8000-0000000000f1";
const START = new Date("2026-10-02T14:00:00Z");
const NOW = new Date("2026-10-02T15:00:00Z");

const step = (over: Partial<MeetingNextStepNote>): MeetingNextStepNote => ({
  kind: "OTHER",
  what: "Something to do",
  owner: null,
  ownerSide: null,
  dueDate: null,
  callAt: null,
  document: null,
  ...over,
});

const STEPS: MeetingNextStepNote[] = [
  step({
    kind: "DOCUMENT_REQUEST",
    what: "Kemi asked for the cohort data",
    owner: "Ada",
    ownerSide: "FOUNDER",
    document: "Cohort data",
  }),
  step({
    kind: "SHARE_DECK",
    what: "Ada shares the deck",
    ownerSide: "FOUNDER",
    document: "deck",
  }),
  step({
    kind: "NEXT_CALL",
    what: "Second call next Tuesday at 3pm",
    ownerSide: null,
    callAt: "2026-10-06T15:00:00Z",
  }),
  step({
    kind: "REMINDER",
    what: "Kemi takes it to IC",
    ownerSide: "INVESTOR",
    dueDate: "2026-10-09",
  }),
];

const base = {
  meetingId: MEETING,
  relationshipId: REL,
  purpose: "Intro call",
  startsAt: START,
  counterpartName: "Savanna Seed",
  agreements: ["Second call next Tuesday"],
  nextSteps: STEPS,
  deckDocumentId: DECK,
  now: NOW,
};

describe("cards after a call", () => {
  it("gives the founder organiser the recap, the deck share and the booking", () => {
    const cards = followUpCards({
      ...base,
      person: { userId: "u-founder", side: "FOUNDER", organiser: true },
    });
    expect(cards.map((c) => c.actionType)).toEqual([
      "app.chat.message.send",
      "app.diligence.document.share",
      "app.schedule.meeting.book",
    ]);
    expect(cards[1]?.payload).toEqual({
      relationshipId: REL,
      input: { documentId: DECK },
    });
    expect(cards[2]?.payload).toMatchObject({
      input: { startsAt: "2026-10-06T15:00:00.000Z", durationMinutes: 30 },
    });
  });

  it("gives the investor the diligence request and their own reminder, never the founder's steps", () => {
    const cards = followUpCards({
      ...base,
      person: { userId: "u-investor", side: "INVESTOR", organiser: false },
    });
    expect(cards.map((c) => c.actionType)).toEqual([
      "app.diligence.document.request",
      "app.schedule.reminder.create",
    ]);
    expect(cards[0]?.payload).toMatchObject({
      input: { title: "Cohort data" },
    });
    expect(cards[1]?.payload).toMatchObject({
      input: { dueAt: "2026-10-09T09:00:00.000Z", relationshipId: REL },
    });
  });

  it("reminds instead of booking when no day and time were agreed, and without a deck", () => {
    const cards = followUpCards({
      ...base,
      deckDocumentId: null,
      nextSteps: [
        step({ kind: "NEXT_CALL", what: "Talk again soon" }),
        step({
          kind: "SHARE_DECK",
          what: "Share the deck",
          ownerSide: "FOUNDER",
        }),
      ],
      agreements: [],
      person: { userId: "u-founder", side: "FOUNDER", organiser: true },
    });
    expect(cards.map((c) => c.actionType)).toEqual([
      "app.chat.message.send",
      "app.schedule.reminder.create",
      "app.schedule.reminder.create",
    ]);
    // Two days after the call, at 09:00 UTC.
    expect(cards[1]?.payload).toMatchObject({
      input: { dueAt: "2026-10-04T09:00:00.000Z" },
    });
  });

  it("never proposes a card whose payload the declared action refuses", () => {
    const cards = followUpCards({
      ...base,
      relationshipId: "not-a-uuid",
      nextSteps: [
        step({ kind: "REMINDER", what: "Check", ownerSide: "FOUNDER" }),
      ],
      agreements: [],
      person: { userId: "u-founder", side: "FOUNDER", organiser: false },
    });
    // The reminder's relationshipId must be a UUID: the card is dropped.
    expect(cards).toEqual([]);
  });

  it("caps the cards and says nothing when nothing was agreed", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      step({
        kind: "REMINDER",
        what: `Task ${String(i)}`,
        ownerSide: "FOUNDER",
      }),
    );
    expect(
      followUpCards({
        ...base,
        nextSteps: many,
        person: { userId: "u", side: "FOUNDER", organiser: true },
      }),
    ).toHaveLength(FOLLOW_UP_CARDS_MAX);
    expect(recapMessage({ agreements: [], nextSteps: [] })).toBeNull();
    expect(
      recapMessage({
        agreements: ["Second call next Tuesday"],
        nextSteps: [step({ what: "Ada shares the deck" })],
      }),
    ).toBe(
      "Thanks for the call today. A quick recap:\n\nWhat we agreed:\n- Second call next Tuesday\n\nNext steps:\n- Ada shares the deck",
    );
  });
});

describe("a request made to Q in the call (meet-47)", () => {
  it("is always the asker's own step, never the other side's action", () => {
    expect(
      callRequestStep({
        request: "Q, send them the deck",
        side: "FOUNDER",
        askerName: "Adaeze",
      }),
    ).toMatchObject({
      kind: "SHARE_DECK",
      ownerSide: "FOUNDER",
      owner: "Adaeze",
    });
    // The investor asking for the deck asks; it never shares the founder's.
    expect(
      callRequestStep({
        request: "Q, send me their deck",
        side: "INVESTOR",
        askerName: "Tunde",
      }),
    ).toMatchObject({
      kind: "DOCUMENT_REQUEST",
      document: "deck",
      ownerSide: "INVESTOR",
    });
    // A founder can't make Q ask the investor for anything: a reminder.
    expect(
      callRequestStep({
        request: "Q, get their term sheet over to me",
        side: "FOUNDER",
        askerName: "Adaeze",
      }),
    ).toMatchObject({ kind: "REMINDER", ownerSide: "FOUNDER" });
    expect(
      callRequestStep({
        request: "Q, book a follow-up call for next week",
        side: "INVESTOR",
        askerName: "Tunde",
      }),
    ).toMatchObject({ kind: "NEXT_CALL", callAt: null });
  });

  it("becomes one card for the asker only", () => {
    const step = callRequestStep({
      request: "Q, send me the financial model",
      side: "INVESTOR",
      askerName: "Tunde",
    });
    const cards = followUpCards({
      person: { userId: "u-investor", side: "INVESTOR", organiser: false },
      meetingId: "00000000-0000-4000-8000-0000000000b1:call-abc",
      relationshipId: "00000000-0000-4000-8000-0000000000e1",
      purpose: "Intro call",
      startsAt: new Date("2026-10-05T10:00:00Z"),
      counterpartName: "Nixo",
      agreements: [],
      nextSteps: [step],
      deckDocumentId: null,
      now: new Date("2026-10-05T10:20:00Z"),
    });
    expect(cards.map((card) => card.actionType)).toEqual([
      "app.diligence.document.request",
    ]);
  });
});
