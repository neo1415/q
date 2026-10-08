import { describe, expect, it } from "vitest";

import {
  QAttentionReportSchema,
  type PermittedContextPlan,
  type QAttentionItem,
  type QWorkDto,
} from "@capital-q/contracts";

import {
  ATTENTION_ITEMS_PER_SOURCE,
  attentionSourcesFromPorts,
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  readAttention,
  type AttentionPort,
  type OwnRelationship,
  type QToolPorts,
} from "../src/index.js";
import { actorA, actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * RECOVERY-2026-10 B1 (founder Scenario F; live T3): "find anything that
 * needs my attention" reads every source, and a source that could not be
 * read is reported unread -- never as nothing.
 */

const NOW = new Date("2026-10-08T12:00:00.000Z");
const REL = "11111111-1111-4111-8111-111111111111";
const REL_2 = "22222222-2222-4222-8222-222222222222";
const REL_3 = "33333333-3333-4333-8333-333333333333";
const COUNTERPART = "44444444-4444-4444-8444-444444444444";
const APPROVAL = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const LANE = "77777777-7777-4777-8777-777777777777";

function relationship(
  id: string,
  name: string,
  extra: Partial<OwnRelationship> = {},
): OwnRelationship {
  return {
    relationshipId: id,
    counterpart: { kind: "INVESTOR_ORGANISATION", id: COUNTERPART, name },
    state: "CONNECTED",
    stateSince: "2026-10-06T09:00:00.000Z",
    nextStep: "NONE",
    milestones: [],
    ...extra,
  };
}

function work(extra: Partial<QWorkDto> = {}): QWorkDto {
  return {
    id: JOB,
    kind: "STANDING_INSTRUCTION",
    status: "ACTIVE",
    summary: null,
    createdAt: "2026-10-05T09:00:00.000Z",
    expiresAt: "2026-11-05T09:00:00.000Z",
    lanes: [],
    goal: "Find seed investors",
    run: null,
    lastStep: null,
    spend: null,
    delegation: null,
    ...extra,
  };
}

/** Every port a real composition holds, answering for actor A. */
function fullPorts(overrides: Partial<QToolPorts> = {}): Partial<QToolPorts> {
  return {
    relationships: {
      ...fakePorts().relationships,
      ownRelationships: () =>
        Promise.resolve({
          side: "COMPANY",
          items: [
            relationship(REL, "Zino Aviation Capital", {
              lastMessage: {
                from: "THEM",
                at: "2026-10-07T15:43:00.000Z",
                preview: "Could you share the updated model?",
              },
            }),
            relationship(REL_2, "Halyard Ventures", {
              state: "INTEREST_EXPRESSED",
              nextStep: "ANSWER_INTEREST",
              lastMessage: {
                from: "YOU",
                at: "2026-10-07T10:00:00.000Z",
                preview: "Thanks!",
              },
            }),
            relationship(REL_3, "Clearwater Partners", {
              state: "IN_DILIGENCE",
            }),
          ],
        }),
      diligence: (_actor, relationshipId) =>
        Promise.resolve(
          relationshipId === REL_3
            ? {
                openRequests: ["Cap table", "Audited accounts"],
                answeredRequests: [],
                sharedDocuments: [],
              }
            : null,
        ),
    } as QToolPorts["relationships"],
    approvalInbox: {
      pending: () =>
        Promise.resolve([
          {
            approvalId: APPROVAL,
            summary: "Send the drafted reply to Halyard Ventures",
            requestedAt: "2026-10-08T08:00:00.000Z",
            expiresAt: "2026-10-09T08:00:00.000Z",
          },
        ]),
    },
    schedule: {
      upcoming: () =>
        Promise.resolve({
          meetings: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              relationshipId: REL,
              purpose: "Intro call",
              startsAt: "2026-10-08T15:00:00.000Z",
              endsAt: "2026-10-08T15:30:00.000Z",
              timeZone: "UTC",
              organisedByYou: true,
              attendees: ["Zino Aviation Capital"],
              hasBrief: true,
            },
            {
              id: "99999999-9999-4999-8999-999999999999",
              relationshipId: REL,
              purpose: "Next month",
              startsAt: "2026-11-08T15:00:00.000Z",
              endsAt: "2026-11-08T15:30:00.000Z",
              timeZone: "UTC",
              organisedByYou: true,
              attendees: [],
              hasBrief: false,
            },
          ],
          reminders: [
            {
              id: "r1",
              title: "Send the deck to Ada",
              dueAt: "2026-10-08T17:00:00.000Z",
              relationshipId: null,
            },
            {
              id: "r2",
              title: "Next week",
              dueAt: "2026-10-15T17:00:00.000Z",
              relationshipId: null,
            },
          ],
        }),
    } as unknown as QToolPorts["schedule"],
    work: {
      list: () =>
        Promise.resolve([
          work({
            status: "FAILED",
            lanes: [
              {
                id: LANE,
                counterpartName: "Ada Fund",
                stage: "NEEDS_TIMES",
                lastStep: null,
                reasons: [],
                offered: [
                  { start: "2026-10-09T10:00:00.000Z", label: "Thu 10:00" },
                ],
              } as unknown as QWorkDto["lanes"][number],
            ],
          }),
        ]),
    } as unknown as QToolPorts["work"],
    attention: {
      sources: {
        HELD_DRAFT: [() => Promise.resolve([])],
        NOTICE: [() => Promise.resolve([])],
        NEW_MATCHES: [() => Promise.resolve([])],
      },
    },
    ...overrides,
  };
}

const read = (ports: Partial<QToolPorts>, deadlineMs?: number) =>
  readAttention(attentionSourcesFromPorts(ports), actorA, {
    now: NOW,
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
  });

describe("the attention report", () => {
  it("lists the unanswered message T3 missed, and every other source", async () => {
    const report = QAttentionReportSchema.parse(await read(fullPorts()));
    const bySource = (source: QAttentionItem["source"]) =>
      report.items.filter((item) => item.source === source);

    expect(bySource("UNANSWERED_MESSAGE")).toEqual([
      expect.objectContaining({
        title: "Zino Aviation Capital is waiting for your reply",
        entity: { kind: "RELATIONSHIP", id: REL },
        since: "2026-10-07T15:43:00.000Z",
        decidable: true,
      }),
    ]);
    // They wrote last on Halyard: not unanswered, but its interest is.
    expect(
      bySource("INTEREST_REQUEST").map((item) => item.counterpart),
    ).toEqual(["Halyard Ventures"]);
    expect(bySource("APPROVAL")[0]?.entity).toEqual({
      kind: "APPROVAL",
      id: APPROVAL,
    });
    expect(bySource("DOCUMENT_REQUEST")[0]?.title).toBe(
      "Clearwater Partners asked for 2 diligence items",
    );
    // A call within 36 hours and times to pick; next month's call is not.
    expect(bySource("MEETING").map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Intro call with Zino Aviation Capital",
        "Pick a time for a call with Ada Fund",
      ]),
    );
    expect(bySource("MEETING")).toHaveLength(2);
    expect(bySource("REMINDER").map((item) => item.title)).toEqual([
      "Send the deck to Ada",
    ]);
    expect(bySource("AGENT_BLOCKED")[0]?.title).toBe(
      "Q's work stopped: Find seed investors",
    );
    // Every source was composed and read.
    expect(report.unread).toEqual([]);
    // Someone waiting on them is said first.
    expect(report.items[0]?.source).toBe("UNANSWERED_MESSAGE");
  });

  it("reports a source whose read fails as unread, keeping the rest", async () => {
    const report = await read(
      fullPorts({
        approvalInbox: {
          pending: () => Promise.reject(new Error("engine down")),
        },
      }),
    );
    expect(report.unread).toEqual(["APPROVAL"]);
    expect(report.items.some((item) => item.source === "APPROVAL")).toBe(false);
    expect(
      report.items.some((item) => item.source === "UNANSWERED_MESSAGE"),
    ).toBe(true);
  });

  it("marks every source fed by one failed relationship read as unread", async () => {
    const ports = fullPorts();
    const report = await read({
      ...ports,
      relationships: {
        ...ports.relationships,
        ownRelationships: () => Promise.reject(new Error("network down")),
      } as QToolPorts["relationships"],
    });
    expect(report.unread).toEqual(
      expect.arrayContaining([
        "UNANSWERED_MESSAGE",
        "INTEREST_REQUEST",
        "MEETING",
        "DOCUMENT_REQUEST",
      ]),
    );
  });

  it("reports a source that is not composed at all as unread, never empty", async () => {
    const report = await read({});
    expect(report.items).toEqual([]);
    expect([...report.unread].sort()).toEqual(
      [
        "AGENT_BLOCKED",
        "APPROVAL",
        "DOCUMENT_REQUEST",
        "HELD_DRAFT",
        "INTEREST_REQUEST",
        "MEETING",
        "NEW_MATCHES",
        "NOTICE",
        "REMINDER",
        "UNANSWERED_MESSAGE",
      ].sort(),
    );
  });

  it("reports a source slower than its deadline as unread", async () => {
    const report = await read(
      fullPorts({
        approvalInbox: { pending: () => new Promise(() => undefined) },
      }),
      30,
    );
    expect(report.unread).toEqual(["APPROVAL"]);
  });

  it("keeps every source within the 50 and says how many more there are", async () => {
    const many = (source: QAttentionItem["source"], n: number) =>
      Array.from({ length: n }, (_, index): QAttentionItem => ({
        key: `${source}:${String(index)}`,
        source,
        title: `${source} ${String(index)}`,
        since: new Date(NOW.getTime() - index * 60_000).toISOString(),
        decidable: false,
      }));
    const port: AttentionPort = {
      sources: {
        NOTICE: [() => Promise.resolve(many("NOTICE", 30))],
        HELD_DRAFT: [() => Promise.resolve(many("HELD_DRAFT", 30))],
        NEW_MATCHES: [() => Promise.resolve(many("NEW_MATCHES", 3))],
      },
    };
    const report = await readAttention(port, actorA, { now: NOW });
    const notices = report.items.filter((item) => item.source === "NOTICE");
    expect(notices).toHaveLength(ATTENTION_ITEMS_PER_SOURCE);
    expect(notices.at(-1)?.detail).toBe("(and 22 more like this)");
    expect(
      report.items.filter((item) => item.source === "NEW_MATCHES"),
    ).toHaveLength(3);
  });

  it("carries an investor's new matches and Q's activity from the app's own port", async () => {
    const port = attentionSourcesFromPorts({
      attention: {
        sources: {
          NEW_MATCHES: [
            () =>
              Promise.resolve([
                {
                  key: "matches:2026-10-08",
                  source: "NEW_MATCHES",
                  title: "3 new companies match your mandate",
                  since: "2026-10-08T06:00:00.000Z",
                  decidable: false,
                },
              ]),
          ],
        },
        activity: (_actor, { since }) =>
          Promise.resolve({
            since: since.toISOString(),
            repliesSent: 2,
            messagesSent: 0,
            callsBooked: 1,
            interestExpressed: 0,
            draftsHeld: 1,
            jobsCompleted: 0,
            names: ["Halyard Ventures"],
          }),
      },
    });
    const report = await readAttention(port, actorA, { now: NOW });
    expect(report.items.map((item) => item.title)).toEqual([
      "3 new companies match your mandate",
    ]);
    expect(report.activity).toEqual(
      expect.objectContaining({ repliesSent: 2, callsBooked: 1 }),
    );
  });
});

describe("the what_needs_me tool", () => {
  function ownPlan(actor = actorA): PermittedContextPlan {
    const plan = planFor(actor, "GENERAL_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ]);
    return {
      ...plan,
      scopes: plan.scopes.map((scope) =>
        scope.kind === "OWN_Q_CONVERSATION"
          ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
          : scope,
      ),
    };
  }
  const executor = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(fakePorts(fullPorts()))),
  });
  const call = { callId: "c-attention", name: "what_needs_me", arguments: {} };

  it("returns the report in the person's own conversation", async () => {
    const outcome = await executor.execute(call, contextFor(actorA, ownPlan()));
    expect(outcome.result.ok).toBe(true);
    const report = QAttentionReportSchema.parse(
      (outcome.result as { data: unknown }).data,
    );
    expect(report.items.length).toBeGreaterThan(0);
  });

  it("is refused in another person's conversation", async () => {
    const outcome = await executor.execute(
      call,
      contextFor(actorB, ownPlan(actorA)),
    );
    expect(outcome.result.ok).toBe(false);
  });
});
