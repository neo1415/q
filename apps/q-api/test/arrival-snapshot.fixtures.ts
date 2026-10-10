import type { QAttentionReport, RelationshipBrief } from "@capital-q/contracts";

/**
 * A TensorGate-shaped relationship (founder 2026-10-09/10): they asked to
 * connect, wrote twice, and a call is booked; the investor's person is
 * waiting to answer. Shared by the unit and integration tests.
 */
export const REL = "7b1c0e55-0000-4000-8000-000000000001";
export const COUNTERPART = "7b1c0e55-0000-4000-8000-000000000002";
export const MEETING = "7b1c0e55-0000-4000-8000-000000000003";
export const NOW = new Date("2026-10-10T09:00:00.000Z");

export function tensorGateBrief(
  overrides: Partial<{
    readonly sequence: number;
    readonly theirText: string;
    readonly meetingStatus: "SCHEDULING" | "SCHEDULED" | "CANCELLED" | "FAILED";
    readonly messagesUnavailable: boolean;
  }> = {},
): RelationshipBrief {
  const text = overrides.theirText ?? "Could we do Thursday 3pm for a call?";
  const theirs = {
    from: "OTHER_SIDE" as const,
    senderName: "Tensor Gate",
    kind: "TEXT" as const,
    delivery: "SENT" as const,
    viaQ: false,
    sentAt: "2026-10-09T15:00:00.000Z",
    preview: text,
  };
  return {
    relationshipId: REL,
    yourSide: "COMPANY",
    counterparty: {
      kind: "INVESTOR_ORGANISATION",
      id: COUNTERPART,
      name: "TensorGate",
    },
    generatedAt: NOW.toISOString(),
    state: {
      state: "CONNECTED",
      stateSince: "2026-10-09T10:00:00.000Z",
      milestones: [],
      nextStep: "SCHEDULE_MEETING",
    },
    messages: {
      count: 2,
      latest:
        overrides.messagesUnavailable === true
          ? { status: "UNAVAILABLE", reason: "READ_FAILED" }
          : { status: "OK", message: theirs, fromThem: theirs },
    },
    noShows: [],
    meetings: {
      status: "OK",
      items: [
        {
          id: MEETING,
          status: overrides.meetingStatus ?? "SCHEDULED",
          startsAt: "2026-10-16T15:00:00.000Z",
          endsAt: "2026-10-16T15:30:00.000Z",
          timing: "UPCOMING",
          organisedByYou: false,
          noShow: false,
        },
      ],
      nextScheduled:
        (overrides.meetingStatus ?? "SCHEDULED") === "SCHEDULED"
          ? {
              id: MEETING,
              status: "SCHEDULED",
              startsAt: "2026-10-16T15:00:00.000Z",
              endsAt: "2026-10-16T15:30:00.000Z",
              timing: "UPCOMING",
              organisedByYou: false,
              noShow: false,
            }
          : null,
    },
    pendingDecisions: {
      items: [
        {
          kind: "ANSWER_INTEREST",
          owner: "YOU",
          since: "2026-10-09T10:00:00.000Z",
        },
      ],
      complete: true,
    },
    obligations: {
      status: "OK",
      openRequests: [
        {
          id: "7b1c0e55-0000-4000-8000-000000000004",
          title: "Latest cap table",
        },
      ],
      answeredCount: 0,
    },
    documents: {
      status: "OK",
      items: [
        {
          id: "7b1c0e55-0000-4000-8000-000000000005",
          title: "Pitch deck v3",
          openedByYourSide: null,
        },
      ],
    },
    sourceVersions: {
      projector: "relationship-state.v2",
      historySequence: overrides.sequence ?? 7,
      brief: "relationship-brief.v1",
    },
  };
}

export function tensorGateReport(): QAttentionReport {
  return {
    items: [
      {
        key: `interest:${REL}`,
        source: "INTEREST_REQUEST",
        title: "TensorGate wants to connect and is waiting for your answer",
        entity: { kind: "RELATIONSHIP", id: REL },
        counterpart: "TensorGate",
        since: "2026-10-09T10:00:00.000Z",
        decidable: true,
      },
      {
        key: "notice:1",
        source: "NOTICE",
        title: "Your profile was viewed",
        note: "An investor opened your profile.",
        since: "2026-10-10T07:00:00.000Z",
        decidable: false,
      },
    ],
    activity: null,
    unread: ["REMINDER"],
    readAt: NOW.toISOString(),
  };
}
