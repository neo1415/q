import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DIGEST_MEETINGS_MAX,
  ACCOUNT_DIGEST_RELATIONSHIPS_MAX,
  Q_ATTENTION_SOURCES,
  QAccountDigestSchema,
  type QWorkDto,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createAccountDigestReader,
  type AccountDigestPorts,
  type OwnRelationship,
  type OwnRelationships,
  type QToolPorts,
} from "../src/index.js";
import { actorA, actorB, fakePorts } from "./support.js";

/**
 * Owner 14 Nov 2026 (audit P0 #2): the account digest every Q turn reads.
 * Two tenants: actor A is a founder (tenant A), actor B an investor
 * (tenant B). Each port answers only for the actor it is asked as, the way
 * the real reads do; the digest must read every source as the asking
 * person and nothing else, once per digest, bounded.
 */

const NOW = new Date("2026-11-14T21:20:00.000Z");
const U = (n: number) =>
  `0d6c1e2a-7b3f-4c1a-9e2d-${String(n).padStart(12, "0")}`;

const FOUNDER_PRIVATE = "Founder-private board pack";

function relationship(
  n: number,
  name: string,
  kind: "COMPANY" | "INVESTOR_ORGANISATION",
  extra: Partial<OwnRelationship> = {},
): OwnRelationship {
  return {
    relationshipId: U(100 + n),
    counterpart: { kind, id: U(200 + n), name },
    state: "CONNECTED",
    stateSince: "2026-11-10T09:00:00.000Z",
    nextStep: "NONE",
    milestones: [],
    ...extra,
  };
}

function work(extra: Partial<QWorkDto> = {}): QWorkDto {
  return {
    id: U(300),
    kind: "INVESTOR_OUTREACH",
    status: "ACTIVE",
    summary: null,
    createdAt: "2026-11-12T09:00:00.000Z",
    expiresAt: "2026-12-12T09:00:00.000Z",
    lanes: [],
    goal: "Reach three seed fintechs",
    run: null,
    lastStep: null,
    spend: null,
    delegation: null,
    ...extra,
  };
}

const BY_ACTOR: Record<string, OwnRelationships> = {
  [actorA.userId]: {
    side: "COMPANY",
    items: [
      relationship(1, "Halyard Ventures", "INVESTOR_ORGANISATION", {
        state: "IN_DILIGENCE",
        lastMessage: {
          from: "THEM",
          at: "2026-11-13T15:00:00.000Z",
          preview: "Could you share the model?",
        },
        milestones: [{ state: "IN_DILIGENCE", at: "2026-11-13T09:00:00.000Z" }],
      }),
    ],
  },
  [actorB.userId]: {
    side: "INVESTOR",
    items: [
      relationship(2, "Ledgerline", "COMPANY", {
        lastMessage: {
          from: "YOU",
          at: "2026-11-12T10:00:00.000Z",
          preview: "Thanks",
        },
      }),
      relationship(3, "Tensorgate", "COMPANY", {
        nextStep: "SCHEDULE_MEETING",
        lastMessage: {
          from: "THEM",
          at: "2026-11-13T15:00:00.000Z",
          preview: "When can we talk?",
        },
      }),
      relationship(4, "Clinicrest", "COMPANY", { state: "IN_DILIGENCE" }),
      relationship(5, "Old Co", "COMPANY", { state: "PASSED" }),
    ],
  },
};

/** Ports that answer for the actor asked, and record who asked. */
function tenantPorts(overrides: Partial<AccountDigestPorts> = {}): {
  ports: AccountDigestPorts;
  asked: ActorContext[];
  reads: Record<string, number>;
} {
  const asked: ActorContext[] = [];
  const reads: Record<string, number> = {};
  const seen = (name: string, actor: ActorContext) => {
    asked.push(actor);
    reads[name] = (reads[name] ?? 0) + 1;
  };
  const ports: AccountDigestPorts = {
    relationships: {
      ...fakePorts().relationships,
      ownRelationships: (actor: ActorContext) => {
        seen("relationships", actor);
        return Promise.resolve(BY_ACTOR[actor.userId] ?? null);
      },
      diligence: (actor: ActorContext, relationshipId: string) => {
        seen("diligence", actor);
        return Promise.resolve(
          actor.userId === actorA.userId && relationshipId === U(101)
            ? {
                openRequests: ["Cap table"],
                answeredRequests: [],
                sharedDocuments: [FOUNDER_PRIVATE],
              }
            : actor.userId === actorB.userId && relationshipId === U(104)
              ? {
                  openRequests: ["Audited accounts 2025"],
                  answeredRequests: ["Cap table", "Deck"],
                  sharedDocuments: [],
                }
              : null,
        );
      },
    } as QToolPorts["relationships"],
    approvalInbox: {
      pending: (actor) => {
        seen("approvals", actor);
        return Promise.resolve(
          actor.userId === actorB.userId
            ? [
                {
                  approvalId: U(400),
                  summary: "Send the diligence request to Clinicrest",
                  requestedAt: "2026-11-14T08:00:00.000Z",
                  expiresAt: "2026-11-15T08:00:00.000Z",
                },
              ]
            : [],
        );
      },
    },
    schedule: {
      upcoming: (actor: ActorContext) => {
        seen("schedule", actor);
        return Promise.resolve({
          meetings:
            actor.userId === actorB.userId
              ? [
                  {
                    id: U(500),
                    relationshipId: U(103),
                    purpose: "Intro call",
                    startsAt: "2026-11-15T09:00:00.000Z",
                    endsAt: "2026-11-15T09:30:00.000Z",
                    timeZone: "Africa/Lagos",
                    organisedByYou: true,
                    attendees: ["Tensorgate"],
                    hasBrief: true,
                  },
                  {
                    id: U(501),
                    relationshipId: U(103),
                    purpose: "Too far ahead",
                    startsAt: "2026-12-20T09:00:00.000Z",
                    endsAt: "2026-12-20T09:30:00.000Z",
                    timeZone: "Africa/Lagos",
                    organisedByYou: true,
                    attendees: [],
                    hasBrief: false,
                  },
                ]
              : [],
          reminders: [],
        });
      },
    } as unknown as QToolPorts["schedule"],
    work: {
      isInvestor: () => Promise.resolve(true),
      hasCompany: () => Promise.resolve(false),
      list: (actor: ActorContext) => {
        seen("work", actor);
        return Promise.resolve(actor.userId === actorB.userId ? [work()] : []);
      },
    } as unknown as QToolPorts["work"],
    // The app's own attention sources (held drafts, notices, ...): none.
    attention: {
      sources: Object.fromEntries(
        Q_ATTENTION_SOURCES.map((source) => [
          source,
          [() => Promise.resolve([])],
        ]),
      ),
    },
    gateqDigest: {
      founderApplications: (actor) => {
        seen("gateq-founder", actor);
        return Promise.resolve(
          actor.userId === actorA.userId
            ? {
                applications: [
                  {
                    applicationId: U(600),
                    fund: "Savanna Seed",
                    status: "SENT" as const,
                    sentAt: "2026-11-11T09:00:00.000Z",
                    replyBy: "2026-11-18",
                  },
                ],
                total: 1,
              }
            : { applications: [], total: 0 },
        );
      },
      investorInbox: (actor) => {
        seen("gateq-inbox", actor);
        return Promise.resolve(
          actor.userId === actorB.userId
            ? {
                gatewayName: "Savanna Seed",
                unread: 4,
                fits: 2,
                partial: 1,
                notAFit: 1,
                needsJudgement: 2,
                top: [],
              }
            : null,
        );
      },
    },
    ...overrides,
  };
  return { ports, asked, reads };
}

describe("the account digest, per role", () => {
  it("an investor's: relationships by stage with what is owed, approvals, calls, work, requests, GateQ inbox", async () => {
    const { ports } = tenantPorts();
    const digest = await createAccountDigestReader(ports)(actorB, { now: NOW });
    expect(QAccountDigestSchema.parse(digest)).toEqual(digest);
    expect(digest.side).toBe("INVESTOR");
    // The reply they owe first, closed last.
    expect(digest.relationships.map((r) => r.counterpart.name)).toEqual([
      "Tensorgate",
      "Ledgerline",
      "Clinicrest",
      "Old Co",
    ]);
    expect(digest.relationships[0]?.owed).toBe("YOU_OWE_REPLY");
    expect(digest.relationships[1]?.owed).toBe("AWAITING_THEM");
    expect(digest.byStage).toEqual({
      CONNECTED: 2,
      IN_DILIGENCE: 1,
      PASSED: 1,
    });
    expect(digest.relationshipCounterpartIds).toEqual([
      U(202),
      U(203),
      U(204),
      U(205),
    ]);
    expect(digest.waiting.map((item) => item.source)).toContain("APPROVAL");
    expect(digest.waiting.map((item) => item.title)).toContain(
      "Tensorgate is waiting for your reply",
    );
    // Fourteen days ahead only.
    expect(digest.meetings.map((m) => m.purpose)).toEqual(["Intro call"]);
    expect(digest.work.map((w) => w.goal)).toEqual([
      "Reach three seed fintechs",
    ]);
    expect(digest.requests).toEqual([
      {
        relationshipId: U(104),
        counterpart: "Clinicrest",
        direction: "FROM_YOU",
        open: ["Audited accounts 2025"],
        openCount: 1,
        answeredCount: 2,
      },
    ]);
    expect(digest.gateq?.inbox?.needsJudgement).toBe(2);
    expect(digest.gateq?.applications).toEqual([]);
    expect(digest.unread).toEqual([]);
  });

  it("a founder's: their investors, requests asked of them, their own GateQ applications", async () => {
    const { ports } = tenantPorts();
    const digest = await createAccountDigestReader(ports)(actorA, { now: NOW });
    expect(digest.side).toBe("COMPANY");
    expect(digest.relationships[0]).toMatchObject({
      counterpart: { name: "Halyard Ventures", kind: "INVESTOR_ORGANISATION" },
      stage: "IN_DILIGENCE",
      owed: "YOU_OWE_REPLY",
    });
    expect(digest.requests[0]).toMatchObject({
      direction: "TO_YOU",
      open: ["Cap table"],
    });
    expect(digest.gateq?.applications.map((a) => a.fund)).toEqual([
      "Savanna Seed",
    ]);
    expect(digest.gateq?.inbox).toBeNull();
    expect(digest.recent.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "Halyard Ventures wrote to you",
        "Halyard Ventures: in diligence",
      ]),
    );
  });
});

describe("the account digest's firewall", () => {
  it("reads every source as the asking person only (cross-tenant negative)", async () => {
    const { ports, asked } = tenantPorts();
    const digest = await createAccountDigestReader(ports)(actorB, { now: NOW });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((actor) => actor === actorB)).toBe(true);
    const said = JSON.stringify(digest);
    // Nothing of tenant A: its relationship, its application, its ids.
    expect(said).not.toContain("Halyard Ventures");
    expect(said).not.toContain(U(101));
    expect(said).not.toContain(U(600));
    expect(said).not.toContain(actorA.tenantId);
  });

  it("never carries founder-private material, not even the founder's own documents, into a digest", async () => {
    const { ports } = tenantPorts();
    const investor = JSON.stringify(
      await createAccountDigestReader(ports)(actorB, { now: NOW }),
    );
    const founder = JSON.stringify(
      await createAccountDigestReader(ports)(actorA, { now: NOW }),
    );
    expect(investor).not.toContain(FOUNDER_PRIVATE);
    // Requests are counted and named; shared documents never enter it.
    expect(founder).not.toContain(FOUNDER_PRIVATE);
  });

  it("reads each source once per digest, though the waiting report reads it too", async () => {
    const { ports, reads } = tenantPorts();
    await createAccountDigestReader(ports)(actorB, { now: NOW });
    expect(reads["relationships"]).toBe(1);
    expect(reads["schedule"]).toBe(1);
    expect(reads["work"]).toBe(1);
    expect(reads["approvals"]).toBe(1);
  });
});

describe("the account digest's bounds", () => {
  it("is bounded however large the account, and says how many it left out", async () => {
    const many: OwnRelationships = {
      side: "INVESTOR",
      items: Array.from({ length: 150 }, (_, i) =>
        relationship(i + 10, `Company ${String(i)}`, "COMPANY", {
          lastMessage: {
            from: "THEM",
            at: "2026-11-13T15:00:00.000Z",
            preview: "x".repeat(400),
          },
        }),
      ),
    };
    const { ports } = tenantPorts({
      relationships: {
        ...fakePorts().relationships,
        ownRelationships: () => Promise.resolve(many),
      } as QToolPorts["relationships"],
    });
    const digest = await createAccountDigestReader(ports)(actorB, { now: NOW });
    expect(digest.relationships).toHaveLength(ACCOUNT_DIGEST_RELATIONSHIPS_MAX);
    expect(digest.relationshipsTotal).toBe(150);
    expect(digest.meetings.length).toBeLessThanOrEqual(
      ACCOUNT_DIGEST_MEETINGS_MAX,
    );
    expect(JSON.stringify(digest).length).toBeLessThan(40_000);
  });

  it("a source that fails is unread, never empty, and the rest still reads", async () => {
    const { ports } = tenantPorts({
      schedule: {
        upcoming: () => Promise.reject(new Error("calendar down")),
      } as unknown as QToolPorts["schedule"],
      gateqDigest: undefined,
    });
    const digest = await createAccountDigestReader(ports)(actorB, { now: NOW });
    expect(digest.unread).toContain("MEETINGS");
    expect(digest.meetings).toEqual([]);
    expect(digest.relationships.length).toBe(4);
    expect(digest.gateq).toBeNull();
  });

  it("a team-jobs read that fails marks the work unread", async () => {
    const { ports } = tenantPorts();
    const digest = await createAccountDigestReader({
      ...ports,
      work: {
        ...ports.work,
        teamJobs: () => Promise.reject(new Error("store down")),
      } as unknown as QToolPorts["work"],
    })(actorB, { now: NOW });
    expect(digest.unread).toContain("WORK");
    expect(digest.work.map((w) => w.goal)).toEqual([
      "Reach three seed fintechs",
    ]);
  });

  it("a person with no ports composed reads as unread, not as nothing", async () => {
    const digest = await createAccountDigestReader({})(actorB, { now: NOW });
    expect(digest.unread).toEqual(
      expect.arrayContaining(["RELATIONSHIPS", "MEETINGS", "WORK"]),
    );
    expect(digest.relationshipsTotal).toBe(0);
  });
});

/**
 * Live check 15 Nov 2026: the lead Q's finished jobs (O2) and answered
 * document requests (O3) were missing from the digest.
 */
describe("the account digest after the live check", () => {
  const job = (
    n: number,
    status: string,
    updatedAt: string,
    goal = `Job ${String(n)}`,
  ) => ({ jobId: U(700 + n), goal, status, updatedAt });

  it("lists the lead Q's running jobs and those finished in the last days, the owner's own only", async () => {
    const asked: ActorContext[] = [];
    const { ports } = tenantPorts();
    const withJobs: AccountDigestPorts = {
      ...ports,
      work: {
        ...ports.work,
        teamJobs: (actor: ActorContext) => {
          asked.push(actor);
          return Promise.resolve(
            actor.userId === actorB.userId
              ? [
                  job(
                    1,
                    "RUNNING",
                    "2026-11-14T20:00:00.000Z",
                    "Memo on Ledgerline",
                  ),
                  job(
                    2,
                    "DONE",
                    "2026-11-12T10:00:00.000Z",
                    "Research fintech seed rounds",
                  ),
                  job(
                    3,
                    "FAILED",
                    "2026-11-12T09:00:00.000Z",
                    "Compare two decks",
                  ),
                  // Finished before the window: left out.
                  job(4, "DONE", "2026-11-01T10:00:00.000Z", "Old research"),
                  // Held for them: still in hand, whatever its age.
                  job(
                    5,
                    "HELD",
                    "2026-10-15T10:00:00.000Z",
                    "Draft to Tensorgate",
                  ),
                ]
              : [],
          );
        },
      } as unknown as QToolPorts["work"],
    };
    const investor = await createAccountDigestReader(withJobs)(actorB, {
      now: NOW,
    });
    expect(QAccountDigestSchema.parse(investor)).toEqual(investor);
    const goals = investor.work.map((w) => w.goal);
    expect(goals).toEqual(
      expect.arrayContaining([
        "Memo on Ledgerline",
        "Research fintech seed rounds",
        "Compare two decks",
        "Draft to Tensorgate",
        "Reach three seed fintechs",
      ]),
    );
    expect(goals).not.toContain("Old research");
    // Running work first.
    expect(
      investor.work
        .slice(0, 3)
        .every((w) => ["ACTIVE", "RUNNING", "HELD"].includes(w.status)),
    ).toBe(true);
    expect(
      investor.work.find((w) => w.goal === "Compare two decks"),
    ).toMatchObject({
      kind: "JOB",
      status: "FAILED",
      updatedAt: "2026-11-12T09:00:00.000Z",
    });
    // Read as the asking person only; the founder's digest has none of them.
    expect(asked.every((actor) => actor === actorB)).toBe(true);
    const founder = await createAccountDigestReader(withJobs)(actorA, {
      now: NOW,
    });
    expect(JSON.stringify(founder)).not.toContain("Memo on Ledgerline");
    expect(asked.at(-1)).toBe(actorA);
  });

  it("shows an answered document request as a recent event on both sides, worded for each", async () => {
    const { ports } = tenantPorts();
    const closed = (actor: ActorContext) =>
      actor.userId === actorA.userId
        ? [
            {
              title: "Cap table",
              status: "FULFILLED" as const,
              at: "2026-11-14T19:19:00.000Z",
            },
            // Before the window: not recent.
            {
              title: "Old deck",
              status: "FULFILLED" as const,
              at: "2026-11-01T10:00:00.000Z",
            },
          ]
        : [
            {
              title: "Cohort table",
              status: "FULFILLED" as const,
              at: "2026-11-14T08:00:00.000Z",
            },
            {
              title: "Bank statements",
              status: "DECLINED" as const,
              at: "2026-11-13T08:00:00.000Z",
            },
          ];
    const base = ports.relationships as NonNullable<
      QToolPorts["relationships"]
    >;
    const withClosed: AccountDigestPorts = {
      ...ports,
      relationships: {
        ...base,
        diligence: async (actor: ActorContext, relationshipId: string) => {
          const area = await base.diligence?.(actor, relationshipId);
          return area === null || area === undefined
            ? null
            : { ...area, closedRequests: closed(actor) };
        },
      },
    };
    const founder = await createAccountDigestReader(withClosed)(actorA, {
      now: NOW,
    });
    expect(founder.recent).toEqual(
      expect.arrayContaining([
        {
          at: "2026-11-14T19:19:00.000Z",
          text: "You answered Halyard Ventures's request for Cap table",
          relationshipId: U(101),
        },
      ]),
    );
    expect(JSON.stringify(founder.recent)).not.toContain("Old deck");
    const investor = await createAccountDigestReader(withClosed)(actorB, {
      now: NOW,
    });
    expect(investor.recent.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "Clinicrest answered your request for Cohort table",
        "Clinicrest declined your request for Bank statements",
      ]),
    );
    // Firewall: neither side's events name the other tenant's requests.
    expect(JSON.stringify(investor.recent)).not.toContain("Halyard");
    expect(JSON.stringify(founder.recent)).not.toContain("Cohort table");
  });
  it("shows a data-room share and a decline in the recent events of each side, in its own words (live audit 2026-11-15 D2)", async () => {
    const { ports } = tenantPorts();
    const asked: ActorContext[] = [];
    const withAnswers: AccountDigestPorts = {
      ...ports,
      attention: {
        ...ports.attention,
        dataRoomAnswers: (actor) => {
          asked.push(actor);
          return Promise.resolve(
            actor.userId === actorB.userId
              ? [
                  {
                    relationshipId: U(101),
                    side: "INVESTOR" as const,
                    counterpart: "Ajopot",
                    title: "Financial summary",
                    decision: "APPROVED" as const,
                    at: "2026-11-14T15:46:00.000Z",
                  },
                  {
                    relationshipId: U(102),
                    side: "INVESTOR" as const,
                    counterpart: "Nsuo Labs",
                    title: null,
                    decision: "DECLINED" as const,
                    at: "2026-11-14T15:49:00.000Z",
                  },
                  // Before the window: not recent.
                  {
                    relationshipId: U(101),
                    side: "INVESTOR" as const,
                    counterpart: "Ajopot",
                    title: "Old memo",
                    decision: "APPROVED" as const,
                    at: "2026-10-01T10:00:00.000Z",
                  },
                ]
              : [
                  {
                    relationshipId: U(101),
                    side: "COMPANY" as const,
                    counterpart: "Savanna Seed",
                    title: "Financial summary",
                    decision: "DECLINED" as const,
                    at: "2026-11-14T15:46:00.000Z",
                  },
                ],
          );
        },
      },
    };
    const investor = await createAccountDigestReader(withAnswers)(actorB, {
      now: NOW,
    });
    expect(investor.recent.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "Ajopot shared Financial summary with you",
        "Nsuo Labs declined your request for their on-request documents",
      ]),
    );
    expect(JSON.stringify(investor.recent)).not.toContain("Old memo");
    const founder = await createAccountDigestReader(withAnswers)(actorA, {
      now: NOW,
    });
    expect(founder.recent.map((event) => event.text)).toEqual(
      expect.arrayContaining([
        "You declined Savanna Seed's request for Financial summary",
      ]),
    );
    expect(QAccountDigestSchema.safeParse(founder).success).toBe(true);
    // Read as the asking person only.
    expect(asked).toEqual([actorB, actorA]);
  });
});
