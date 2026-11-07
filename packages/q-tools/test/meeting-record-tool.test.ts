import { describe, expect, it } from "vitest";

import {
  RelationshipBriefSchema,
  type PermittedContextPlan,
  type QMeetingAssistantDto,
  type RelationshipBrief,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  boundedTranscript,
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  meetingProposals,
  type MeetingRecordPort,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * W5.3 (Q Workspace plan §5): read_meeting -- what was said in a recorded
 * call, a Safe Read for the call's participants only, with follow-ups Q
 * may PROPOSE (never record): money mentioned is a signal; recording it is
 * the person's approval of the exact amount, and a hard commitment is
 * only ever their own statement that the money moved.
 */

const RELATIONSHIP = "88888888-0000-4000-8000-000000000001";
const OTHER_RELATIONSHIP = "88888888-0000-4000-8000-000000000009";
const PAST_CALL = "88888888-0000-4000-8000-0000000000d1";
const UPCOMING_CALL = "88888888-0000-4000-8000-0000000000d3";
const STRANGER_CALL = "88888888-0000-4000-8000-0000000000e1";

function brief(): RelationshipBrief {
  return RelationshipBriefSchema.parse({
    relationshipId: RELATIONSHIP,
    yourSide: "INVESTOR",
    counterparty: {
      kind: "COMPANY",
      id: COMPANY_B_NETWORK,
      name: "Ledgerfold",
    },
    generatedAt: "2026-11-06T23:30:00.000Z",
    state: {
      state: "CONNECTED",
      stateSince: "2026-11-01T17:21:54.076Z",
      milestones: [{ state: "CONNECTED", at: "2026-11-01T17:21:54.076Z" }],
      nextStep: "SCHEDULE_MEETING",
    },
    messages: {
      count: 0,
      latest: { status: "OK", message: null, fromThem: null },
    },
    meetings: {
      status: "OK",
      items: [
        {
          id: PAST_CALL,
          status: "SCHEDULED",
          startsAt: "2026-11-05T15:00:00.000Z",
          endsAt: "2026-11-05T15:30:00.000Z",
          timing: "PAST",
          organisedByYou: true,
        },
        {
          id: UPCOMING_CALL,
          status: "SCHEDULED",
          startsAt: "2026-11-12T15:00:00.000Z",
          endsAt: "2026-11-12T15:30:00.000Z",
          timing: "UPCOMING",
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
      historySequence: 1,
      brief: "relationship-brief.v1",
    },
  });
}

const RECORD: QMeetingAssistantDto = {
  meetingId: PAST_CALL,
  status: "DONE",
  attendees: [
    { name: "Ada", side: "FOUNDER" },
    { name: "Marcus", side: "INVESTOR" },
  ],
  agreements: ["Ledgerfold sends the updated model by Friday."],
  commitments: [
    {
      party: "Marcus",
      amount: "$2M",
      firmness: "SOFT",
      quote: "we're thinking about two million",
    },
  ],
  transcript: [
    { speaker: "Ada", text: "Our churn is under two percent." },
    { speaker: "Marcus", text: "We're thinking about two million." },
  ],
  summary: "A good call; churn is low.",
  flags: [],
  followUps: [{ text: "Send the updated model", owner: "Ada" }],
  failure: null,
  declined: null,
  updatedAt: "2026-11-05T16:00:00.000Z",
};

/** The meeting assistant: participants only, as the real one answers. */
function meetings(participant: (actor: ActorContext) => boolean) {
  const reads: string[] = [];
  const port: MeetingRecordPort = {
    read: (actor, meetingId) => {
      reads.push(meetingId);
      if (!participant(actor) || meetingId !== PAST_CALL)
        return Promise.resolve(null);
      return Promise.resolve(RECORD);
    },
  };
  return { port, reads };
}

function relationshipPlan(
  actor: ActorContext,
  relationshipId: string,
): PermittedContextPlan {
  const base = planFor(actor, "RELATIONSHIP_QUESTION", [
    { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
  ]);
  const template = base.scopes[0];
  if (template === undefined) throw new Error("plan has no scope");
  return {
    ...base,
    subjects: [{ kind: "RELATIONSHIP", relationshipId }],
    scopes: [
      ...base.scopes,
      {
        ...template,
        kind: "RELATIONSHIP_CONTEXT",
        subject: { kind: "RELATIONSHIP", relationshipId },
        contextLabel: "relationship_shared",
        filter: {
          tenantId: base.tenantId,
          relationshipIds: [relationshipId],
          contextLabels: ["investor_private", "relationship_shared"],
        },
      },
    ],
  };
}

function tools(port: MeetingRecordPort) {
  const relationships = {
    withCompany: () => Promise.resolve(null),
    withInvestor: () => Promise.resolve(null),
    byRelationship: () => Promise.resolve(null),
    incomingInterest: () => Promise.resolve([]),
    mayExpressInterest: () => Promise.resolve(false),
    mayAnswerInterest: () => Promise.resolve(false),
    prepareForApproval: () => "PREPARED" as const,
    brief: (_actor: ActorContext, relationshipId: string) =>
      Promise.resolve(relationshipId === RELATIONSHIP ? brief() : null),
  } satisfies RelationshipIntelligencePort;
  return createQToolExecutor({
    registry: createQToolRegistry(
      createDefaultQTools(fakePorts({ relationships, meetings: port })),
    ),
  });
}

const ask = (args: Record<string, unknown>) => ({
  callId: "m1",
  name: "read_meeting",
  arguments: args,
});

type Read = {
  meetingId: string;
  record: string;
  moneyMentioned: { amount: string }[];
  transcript: { text: string }[];
  proposals: string[];
};

describe("read_meeting", () => {
  it("gives a participant the last past call's record, with proposals, never a recorded commitment", async () => {
    const { port, reads } = meetings((actor) => actor.userId === actorB.userId);
    const outcome = await tools(port).execute(
      ask({ relationshipId: RELATIONSHIP }),
      contextFor(actorB, relationshipPlan(actorB, RELATIONSHIP)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as Read;
    expect(data.meetingId).toBe(PAST_CALL);
    expect(data.record).toBe("READY");
    expect(data.moneyMentioned[0]?.amount).toBe("$2M");
    expect(data.transcript).toHaveLength(2);
    expect(data.proposals[0]).toMatch(/soft commitment/u);
    expect(data.proposals[0]).toMatch(/approves the exact amount/u);
    expect(data.proposals[0]).toMatch(
      /Never call it committed, firm or invested/u,
    );
    // The past call only: the upcoming one has no record.
    expect(reads).toEqual([PAST_CALL]);
  });

  it("is nothing for someone who was not on the call", async () => {
    const { port } = meetings(() => false);
    const outcome = await tools(port).execute(
      ask({ relationshipId: RELATIONSHIP }),
      contextFor(actorA, relationshipPlan(actorA, RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
  });

  it("is refused before reading when the relationship is not the one bound for this run", async () => {
    const { port, reads } = meetings(() => true);
    const outcome = await tools(port).execute(
      ask({ relationshipId: RELATIONSHIP }),
      contextFor(actorB, relationshipPlan(actorB, OTHER_RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(reads).toEqual([]);
  });

  it("will not read a call that is not this relationship's, even by id", async () => {
    const { port, reads } = meetings(() => true);
    const outcome = await tools(port).execute(
      ask({ relationshipId: RELATIONSHIP, meetingId: STRANGER_CALL }),
      contextFor(actorB, relationshipPlan(actorB, RELATIONSHIP)),
    );
    expect(outcome.status).toBe("DENIED");
    expect(reads).toEqual([]);
  });
});

describe("what Q may propose from a call", () => {
  it("proposes, for approval, and never states the money as committed", () => {
    const proposals = meetingProposals({
      commitments: [
        {
          party: "Marcus",
          amount: "$2M",
          firmness: "FIRM",
          quote: "we're in for two",
        },
      ],
      followUps: [],
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatch(/offer to record it as a soft commitment/u);
    expect(proposals[0]).toMatch(/only when the person approves/u);
  });

  it("keeps a long transcript from its start, whole lines, and says it was cut", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({
      speaker: "A",
      text: `line ${String(index)} ${"x".repeat(20)}`,
    }));
    const kept = boundedTranscript(lines, 100);
    expect(kept.cut).toBe(true);
    expect(kept.lines[0]?.text).toMatch(/^line 0/u);
    expect(boundedTranscript(lines).cut).toBe(false);
  });
});
