import { describe, expect, it } from "vitest";

import {
  RelationshipBriefSchema,
  type RelationshipBrief,
} from "@capital-q/contracts";

import { briefLines } from "@/features/relationships/brief-lines";
import { digestFacts } from "@/features/relationships/relationship-data";
import { nextStepFor } from "@/features/relationships/relationships-view";

/** R1: the overview's standing lines, from the TensorGate shape (hosted 2026-10-09). */
function brief(overrides: Partial<RelationshipBrief> = {}): RelationshipBrief {
  return RelationshipBriefSchema.parse({
    relationshipId: "88888888-0000-4000-8000-0000000000b1",
    yourSide: "INVESTOR",
    counterparty: {
      kind: "COMPANY",
      id: "88888888-0000-4000-8000-0000000000c1",
      name: "Tensorgate",
    },
    generatedAt: "2026-10-09T23:30:00.000Z",
    state: null,
    messages: {
      count: 12,
      latest: {
        status: "OK",
        message: {
          from: "YOU",
          senderName: "Marcus",
          kind: "TEXT",
          delivery: "SENT",
          viaQ: true,
          sentAt: "2026-10-09T15:33:39.798Z",
        },
        fromThem: null,
      },
    },
    meetings: {
      status: "OK",
      items: [
        {
          id: "88888888-0000-4000-8000-0000000000d1",
          status: "SCHEDULED",
          startsAt: "2026-10-08T15:00:00.000Z",
          endsAt: "2026-10-08T15:30:00.000Z",
          timing: "PAST",
          organisedByYou: true,
        },
      ],
      nextScheduled: null,
    },
    pendingDecisions: { items: [], complete: true },
    obligations: { status: "OK", openRequests: [], answeredCount: 0 },
    documents: { status: "OK", items: [] },
    sourceVersions: {
      projector: "relationship-state.v2",
      historySequence: 21,
      brief: "relationship-brief.v1",
    },
    ...overrides,
  });
}

describe("briefLines", () => {
  it("states TensorGate's messages and its held call", () => {
    const lines = briefLines(brief(), "Tensorgate");
    expect(lines[0]).toMatch(/^12 messages, latest from you on /);
    expect(lines[1]).toMatch(/^Last call /);
  });

  it("a call recorded as a no-show is said so, not as the last call", () => {
    const base = brief();
    if (base.meetings.status !== "OK") throw new Error("fixture");
    const lines = briefLines(
      brief({
        meetings: {
          ...base.meetings,
          items: base.meetings.items.map((m) => ({ ...m, noShow: true })),
        },
      }),
      "Tensorgate",
    );
    expect(lines[1]).toMatch(/^The call on .* didn't take place$/);
  });

  it("an unreadable chat or schedule is unknown, never 'none'", () => {
    const lines = briefLines(
      brief({
        messages: {
          count: 0,
          latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
        },
        meetings: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      }),
      "Tensorgate",
    );
    expect(lines).toEqual([
      "Messages couldn't be read just now",
      "Calls couldn't be read just now",
    ]);
    expect(lines.join(" ")).not.toMatch(/No messages|No call/);
  });

  it("says 'none' only when the sources were read and hold none", () => {
    const lines = briefLines(
      brief({
        messages: {
          count: 0,
          latest: { status: "OK", message: null, fromThem: null },
        },
        meetings: { status: "OK", items: [], nextScheduled: null },
      }),
      "Tensorgate",
    );
    expect(lines).toEqual(["No messages yet", "No call booked"]);
  });
});

describe("list cards from the brief (R1 batching)", () => {
  it("TensorGate's card: the whole count and the latest preview", () => {
    const facts = digestFacts(brief(), false);
    expect(facts.messages).toMatchObject({ count: 12, last: { mine: true } });
    expect(facts.callsRead).toBe(true);
  });

  it("an unread chat or schedule is unknown on the card, and no 'Book a call' is offered over it", () => {
    const facts = digestFacts(
      brief({
        messages: {
          count: 12,
          latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
        },
        meetings: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      }),
      false,
    );
    expect(facts.messages).toBeNull();
    expect(facts.callsRead).toBe(false);
    const step = nextStepFor(
      { stateSince: "2026-10-06T17:21:54.076Z", nextStep: "SCHEDULE_MEETING" },
      {
        unread: 0,
        followUpDue: false,
        nextCallAt: null,
        callsRead: false,
        lastMessageAt: null,
        diligence: null,
      },
      "INVESTOR",
      Date.parse("2026-10-09T23:30:00.000Z"),
      "/relationships/company/x",
    );
    expect(step.label).toBeNull();
    expect(step.why).toBe("Calls couldn't be read just now");
  });

  it("a missing brief is unknown, never empty", () => {
    expect(digestFacts(undefined, true)).toEqual({
      messages: null,
      nextCall: null,
      callsRead: false,
      diligence: null,
    });
  });
});
