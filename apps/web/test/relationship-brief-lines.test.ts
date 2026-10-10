import { describe, expect, it } from "vitest";

import {
  RelationshipBriefSchema,
  type RelationshipBrief,
} from "@capital-q/contracts";

import { briefLines } from "@/features/relationships/brief-lines";

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
