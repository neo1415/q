import { describe, expect, it } from "vitest";

import {
  RelationshipBriefSchema,
  type RelationshipBrief,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type RelationshipIntelligencePort,
} from "../src/index.js";
import { briefFacts } from "../src/tools/relationship-brief-facts.js";
import {
  actorA,
  actorB,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * R1: the Relationship Brief in Q's get_relationship. The TensorGate shape
 * (hosted 2026-10-09): twelve messages, a booked call, and the summary
 * Q used to read was missing -- Q said "no message has been sent".
 */

const RELATIONSHIP = "88888888-0000-4000-8000-0000000000b1";
const INVESTOR = "88888888-0000-4000-8000-0000000000b2";

function tensorGateBrief(
  overrides: Partial<RelationshipBrief> = {},
): RelationshipBrief {
  return RelationshipBriefSchema.parse({
    relationshipId: RELATIONSHIP,
    yourSide: "INVESTOR",
    counterparty: {
      kind: "COMPANY",
      id: COMPANY_B_NETWORK,
      name: "Tensorgate",
    },
    generatedAt: "2026-10-09T23:30:00.000Z",
    state: {
      state: "CONNECTED",
      stateSince: "2026-10-06T17:21:54.076Z",
      milestones: [
        { state: "INTEREST_EXPRESSED", at: "2026-10-06T14:16:48.644Z" },
        { state: "CONNECTED", at: "2026-10-06T17:21:54.076Z" },
      ],
      nextStep: "SCHEDULE_MEETING",
    },
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
        fromThem: {
          from: "OTHER_SIDE",
          senderName: "Ada",
          kind: "TEXT",
          delivery: "SENT",
          viaQ: true,
          sentAt: "2026-10-09T11:25:43.387Z",
        },
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
        {
          id: "88888888-0000-4000-8000-0000000000d2",
          status: "CANCELLED",
          startsAt: "2026-10-09T14:45:00.000Z",
          endsAt: "2026-10-09T15:15:00.000Z",
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

describe("briefFacts", () => {
  it("states the messages and the booked call for TensorGate's shape", () => {
    const facts = briefFacts(tensorGateBrief()).join("\n");
    expect(facts).toContain("12 message(s) in the chat with Tensorgate");
    expect(facts).toContain("sent by you (sent by Q) at 2026-10-09 15:33 UTC");
    expect(facts).toContain("Tensorgate last wrote at 2026-10-09 11:25 UTC");
    expect(facts).toContain("A call was booked for 2026-10-08 15:00 UTC");
    expect(facts).toContain("A call for 2026-10-09 14:45 UTC was cancelled");
    expect(facts).not.toMatch(/no messages|not written|No call/i);
  });

  it("never turns an unreadable chat into 'no messages'", () => {
    const brief = tensorGateBrief({
      messages: {
        count: 12,
        latest: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      },
      meetings: { status: "UNAVAILABLE", reason: "READ_FAILED" },
    });
    const facts = briefFacts(brief).join("\n");
    expect(facts).toContain("12 message(s) are recorded");
    expect(facts).toContain("could not be read right now");
    expect(facts).toContain("Calls with Tensorgate could not be read");
    expect(facts).not.toMatch(/No messages|No call has been booked/);
  });

  it("says 'no messages' only when the chat was read and the history has none", () => {
    const brief = tensorGateBrief({
      messages: {
        count: 0,
        latest: { status: "OK", message: null, fromThem: null },
      },
    });
    expect(briefFacts(brief)).toContain(
      "No messages have been sent in the chat with Tensorgate.",
    );
  });
});

describe("get_relationship carries the brief", () => {
  const status: RelationshipStatusDto = {
    relationshipId: RELATIONSHIP,
    companyId: COMPANY_B_NETWORK,
    investorOrganisationId: INVESTOR,
    state: "CONNECTED",
    stateSince: "2026-10-06T17:21:54.076Z",
    milestones: [{ state: "CONNECTED", at: "2026-10-06T17:21:54.076Z" }],
    nextStep: "SCHEDULE_MEETING",
    projectorVersion: "relationship-state.v2",
  };

  function run(brief: RelationshipIntelligencePort["brief"]) {
    const reads: string[] = [];
    const port = {
      withCompany: (actor: ActorContext) =>
        actor.userId === actorB.userId
          ? Promise.resolve(status)
          : Promise.reject(new Error("not an investor")),
      withInvestor: () => Promise.resolve(null),
      byRelationship: () => Promise.resolve(null),
      incomingInterest: () => Promise.resolve([]),
      mayExpressInterest: () => Promise.resolve(false),
      mayAnswerInterest: () => Promise.resolve(false),
      prepareForApproval: () => "PREPARED" as const,
      ...(brief === undefined
        ? {}
        : {
            brief: (actor: ActorContext, relationshipId: string) => {
              reads.push(`${actor.userId}:${relationshipId}`);
              return brief(actor, relationshipId);
            },
          }),
    } satisfies RelationshipIntelligencePort;
    const executor = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(fakePorts({ relationships: port })),
      ),
    });
    const plan = (actor: ActorContext) =>
      planFor(actor, "GENERAL_QUESTION", [
        { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
      ]);
    return {
      reads,
      ask: (actor: ActorContext) =>
        executor.execute(
          {
            callId: "b1",
            name: "get_relationship",
            arguments: { companyId: COMPANY_B_NETWORK },
          },
          contextFor(actor, plan(actor)),
        ),
    };
  }

  it("answers messages and calls from the brief, by code", async () => {
    const { ask, reads } = run(() => Promise.resolve(tensorGateBrief()));
    const outcome = await ask(actorB);
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    const data = outcome.result.data as {
      brief: { status: string; facts: string[]; detail: RelationshipBrief };
    };
    expect(data.brief.status).toBe("OK");
    expect(data.brief.detail.messages.count).toBe(12);
    expect(data.brief.facts.join(" ")).toContain("A call was booked");
    expect(reads).toEqual([`${actorB.userId}:${RELATIONSHIP}`]);
  });

  it("a failing brief is UNAVAILABLE, and the relationship still answers", async () => {
    const { ask } = run(() => Promise.reject(new Error("db down")));
    const outcome = await ask(actorB);
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("unreachable");
    expect(outcome.result.data).toMatchObject({
      brief: { status: "UNAVAILABLE" },
      relationship: { state: "CONNECTED" },
    });
  });

  it("someone who is not the investor never reaches the brief", async () => {
    const { ask, reads } = run(() => Promise.resolve(tensorGateBrief()));
    const outcome = await ask(actorA);
    expect(outcome.status).toBe("DENIED");
    expect(reads).toEqual([]);
  });
});
