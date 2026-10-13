import { describe, expect, it } from "vitest";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import type {
  MemoryConversationDigest,
  MemoryItem,
} from "../src/memory/contracts.js";
import {
  buildConnectedRecall,
  CONNECTED_LABEL,
  CONNECTED_MAX,
  connectedRecallWithin,
  GRAPH_STALE_DAYS,
  namesCompany,
  planGraphRecall,
  renderConnectedRecall,
  type GraphConversation,
  type GraphDocument,
  type GraphJob,
  type GraphMandateFit,
  type RecallGraphPort,
} from "../src/memory/graph.js";
import type { MemoryRepository } from "../src/memory/postgres-memory-repository.js";
import { MEMORY_TEXT_MAX, renderMemoryBundle } from "../src/memory/render.js";
import {
  createMemoryService,
  type MemoryConversationDigestPort,
} from "../src/memory/service.js";

/**
 * Connected recall (Lane B). A deterministic offline benchmark built from
 * fixtures shaped like the real rows (q_runtime.conversations, workforce
 * jobs and their persisted step outputs, artifacts, the knowledge fit
 * projection, memory items), for investor.savanna-seed, measuring what
 * recall renders for two multi-hop questions before (today's sections) and
 * after (with the connected section). No network, no model, no database.
 *
 * The fixture world has a second person in the same organisation, a second
 * tenant and Tensorgate's own founder; a port that is honest about scope
 * returns none of their rows, and the tests prove none reaches the prompt.
 */

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const SAVANNA_TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAVANNA_ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOUNDER_ORG = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const investor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: SAVANNA_TENANT,
  organisationId: SAVANNA_ORG,
  membershipId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
  actorType: "HUMAN",
});
const colleague = ActorContextSchema.parse({
  ...investor,
  userId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
});
const otherTenant = ActorContextSchema.parse({
  userId: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
  tenantId: OTHER_TENANT,
  organisationId: "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3",
  membershipId: "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3",
  actorType: "HUMAN",
});
const tensorgateFounder = ActorContextSchema.parse({
  userId: "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
  tenantId: "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4",
  organisationId: FOUNDER_ORG,
  membershipId: "e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4",
  actorType: "HUMAN",
});

const TENSORGATE = "10000000-0000-4000-8000-000000000001";
const KWARA = "10000000-0000-4000-8000-000000000002";
const LUMEN = "10000000-0000-4000-8000-000000000003";
const ORBIT = "10000000-0000-4000-8000-000000000004";
const SECRET_CO = "10000000-0000-4000-8000-000000000005";
const NAMES: Record<string, string> = {
  [TENSORGATE]: "Tensorgate",
  [KWARA]: "Kwara Grid",
  [LUMEN]: "Lumen Pay",
  [ORBIT]: "Orbit Freight",
  [SECRET_CO]: "Quietwater",
};
const MEMO_V2 = "20000000-0000-4000-8000-000000000001";
const LUMEN_MEMO = "20000000-0000-4000-8000-000000000002";
const FOUNDER_DECK = "20000000-0000-4000-8000-000000000003";
const COLLEAGUE_MEMO = "20000000-0000-4000-8000-000000000004";

type Owned<T> = T & { readonly tenantId: string; readonly userId?: string };
type OrgOwned<T> = T & {
  readonly tenantId: string;
  readonly organisationId: string;
};

/** Every row of the fixture world, whoever owns it. */
type World = {
  conversations: Owned<GraphConversation>[];
  jobs: Owned<GraphJob>[];
  documents: OrgOwned<GraphDocument>[];
  mandates: (GraphMandateFit & { readonly organisationId: string })[];
  memories: MemoryItem[];
};

function memory(
  over: Partial<MemoryItem> & Pick<MemoryItem, "id" | "content">,
): MemoryItem {
  return {
    tenantId: investor.tenantId,
    ownerContextType: "user",
    ownerContextId: investor.userId,
    subject: { subjectType: "COMPANY", subjectId: TENSORGATE },
    memoryType: "fact",
    memoryKey: "company.concern",
    structuredValue: {},
    quote: null,
    contentSha256: "0".repeat(64),
    sourceConversationId: null,
    sourceRunId: null,
    writeMode: "Q_PROPOSED",
    status: "active",
    supersededBy: null,
    validFrom: daysAgo(20),
    validTo: null,
    lastUsedAt: null,
    useCount: 0,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
    ...over,
  };
}

function world(): World {
  return {
    conversations: [
      // Opened on Tensorgate's profile: a subject ref.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-000000000001",
        title: "Tensorgate first look",
        summary:
          "Walked through Tensorgate's deck; investor worried about churn and the lead requirement.",
        at: daysAgo(12),
        companyIds: [TENSORGATE],
      },
      // From Home, no subject ref: found by the name in its summary.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-000000000002",
        title: "Energy pipeline",
        summary:
          "Compared Kwara Grid and Orbit Freight on unit economics; asked for Kwara Grid's metering data.",
        at: daysAgo(6),
        companyIds: [],
      },
      // Opened on Orbit Freight's profile; not in the mandate's slate.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-000000000007",
        title: "Orbit Freight profile",
        summary: "Looked at Orbit Freight's logistics margins.",
        at: daysAgo(8),
        companyIds: [ORBIT],
      },
      // Discussed again after the memo.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-000000000003",
        title: "Tensorgate follow-up",
        summary:
          "Asked whether Tensorgate's new deck answers the churn concern.",
        at: daysAgo(2),
        companyIds: [TENSORGATE],
      },
      // Outside the month.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-000000000004",
        title: "Lumen Pay intro",
        summary: "Initial look at Lumen Pay's payments volume.",
        at: daysAgo(50),
        companyIds: [LUMEN],
      },
      // Not the investor's: a colleague and another tenant.
      {
        tenantId: SAVANNA_TENANT,
        userId: colleague.userId,
        conversationId: "30000000-0000-4000-8000-000000000005",
        title: "Quietwater",
        summary: "Colleague's private notes on Quietwater.",
        at: daysAgo(3),
        companyIds: [SECRET_CO],
      },
      {
        tenantId: OTHER_TENANT,
        userId: otherTenant.userId,
        conversationId: "30000000-0000-4000-8000-000000000006",
        title: "Tensorgate (another fund)",
        summary: "Another fund thinks Tensorgate's burn is too high.",
        at: daysAgo(1),
        companyIds: [TENSORGATE],
      },
    ],
    jobs: [
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        jobId: "40000000-0000-4000-8000-000000000001",
        goal: "Write an investment memo on Tensorgate and review it",
        state: "COMPLETED",
        finishedAt: daysAgo(9),
        updatedAt: daysAgo(9),
        conversationId: "30000000-0000-4000-8000-000000000001",
        documents: [{ artifactId: MEMO_V2, companyId: TENSORGATE }],
        review: {
          artifactId: MEMO_V2,
          material: true,
          issues: [
            {
              kind: "MISSING_RISK",
              section: "Risks",
              problem:
                "Customer concentration in two design partners is not discussed",
            },
            {
              kind: "UNSUPPORTED",
              section: "Traction",
              problem: "Net revenue retention is asserted without a source",
            },
          ],
          revisedToVersion: 2,
        },
        diligence: {
          questions: ["What is gross churn over the last twelve months?"],
          filedForApproval: true,
        },
      },
      {
        tenantId: SAVANNA_TENANT,
        userId: colleague.userId,
        jobId: "40000000-0000-4000-8000-000000000002",
        goal: "Colleague memo",
        state: "COMPLETED",
        finishedAt: daysAgo(4),
        updatedAt: daysAgo(4),
        conversationId: null,
        documents: [{ artifactId: COLLEAGUE_MEMO, companyId: SECRET_CO }],
        review: {
          artifactId: COLLEAGUE_MEMO,
          material: false,
          issues: [
            {
              kind: "UNSUPPORTED",
              section: "Team",
              problem: "COLLEAGUE-ONLY finding",
            },
          ],
          revisedToVersion: null,
        },
        diligence: null,
      },
    ],
    documents: [
      {
        tenantId: SAVANNA_TENANT,
        organisationId: SAVANNA_ORG,
        artifactId: MEMO_V2,
        type: "MEMO",
        title: "Tensorgate investment memo",
        summary: "Seed memo",
        companyId: TENSORGATE,
        status: "READY",
        version: 2,
        updatedAt: daysAgo(9),
      },
      {
        tenantId: SAVANNA_TENANT,
        organisationId: SAVANNA_ORG,
        artifactId: LUMEN_MEMO,
        type: "MEMO",
        title: "Lumen Pay memo",
        summary: "Old memo",
        companyId: LUMEN,
        status: "READY",
        version: 1,
        updatedAt: daysAgo(120),
      },
      // The founder's own organisation's document about Tensorgate:
      // founder-private, never the investor's.
      {
        tenantId: tensorgateFounder.tenantId,
        organisationId: FOUNDER_ORG,
        artifactId: FOUNDER_DECK,
        type: "PITCH_DECK",
        title: "FOUNDER-PRIVATE runway plan",
        summary: "Cash 14 months",
        companyId: TENSORGATE,
        status: "READY",
        version: 3,
        updatedAt: daysAgo(1),
      },
    ],
    mandates: [
      {
        organisationId: SAVANNA_ORG,
        mandateName: "Savanna Seed Fund I",
        mandateVersion: 3,
        slateGeneratedAt: daysAgo(1),
        companyIds: [KWARA, TENSORGATE, SECRET_CO],
      },
    ],
    memories: [
      memory({
        id: "50000000-0000-4000-8000-000000000001",
        content: "Worried Tensorgate's churn is above 3% a month",
        createdAt: daysAgo(12),
      }),
      memory({
        id: "50000000-0000-4000-8000-000000000002",
        content: "Wants Tensorgate's lead investor confirmed before IC",
        memoryKey: "company.lead",
        createdAt: daysAgo(3),
      }),
    ],
  };
}

/** A port that is honest about scope, as the q-api adapter is. */
function portOver(w: World, calls: string[] = []): RecallGraphPort {
  const mine = (
    actor: ActorContext,
    row: { tenantId: string; userId?: string },
  ) => row.tenantId === actor.tenantId && row.userId === actor.userId;
  return {
    conversations: (actor, query) => {
      calls.push("conversations");
      return Promise.resolve(
        w.conversations
          .filter((c) => mine(actor, c) && c.at >= query.since)
          .slice(0, query.limit),
      );
    },
    jobs: (actor, query) => {
      calls.push("jobs");
      return Promise.resolve(
        w.jobs.filter((j) => mine(actor, j)).slice(0, query.limit),
      );
    },
    documents: (actor, query) => {
      calls.push("documents");
      return Promise.resolve(
        w.documents
          .filter(
            (d) =>
              d.tenantId === actor.tenantId &&
              d.organisationId === actor.organisationId,
          )
          .slice(0, query.limit),
      );
    },
    mandateFit: (actor) => {
      calls.push("mandate");
      return Promise.resolve(
        w.mandates.find((m) => m.organisationId === actor.organisationId) ??
          null,
      );
    },
    companies: (_actor, ids) => {
      calls.push("companies");
      return Promise.resolve(
        ids.flatMap((id) =>
          NAMES[id] === undefined ? [] : [{ companyId: id, name: NAMES[id] }],
        ),
      );
    },
  };
}

const tx = {
  sql: Object.assign(() => Promise.resolve([]), {}),
} as unknown as TransactionContext;
const transactions: TransactionManager = { run: (work) => work(tx) };

/** Today's conversation port over the same world (owner-scoped). */
function digestPort(w: World): MemoryConversationDigestPort {
  const own = (actor: ActorContext) =>
    w.conversations.filter(
      (c) => c.tenantId === actor.tenantId && c.userId === actor.userId,
    );
  const digest = (c: GraphConversation): MemoryConversationDigest => ({
    conversationId: c.conversationId,
    title: c.title,
    summary: c.summary ?? "",
    lastMessageAt: c.at,
  });
  return {
    digestOf: (actor, id) => {
      const c = own(actor).find((one) => one.conversationId === id);
      return Promise.resolve(
        c === undefined ? null : { title: c.title, summary: c.summary },
      );
    },
    recentDigests: (actor, except, limit) =>
      Promise.resolve(
        own(actor)
          .filter((c) => c.conversationId !== except && c.summary !== null)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit)
          .map(digest),
      ),
    relevantDigests: (actor, query) =>
      Promise.resolve(
        own(actor)
          .filter(
            (c) =>
              c.companyIds.some((id) => query.companyIds.includes(id)) ||
              query.terms.some((t) =>
                `${c.title ?? ""} ${c.summary ?? ""}`
                  .toLowerCase()
                  .includes(t.toLowerCase()),
              ),
          )
          .slice(0, query.limit)
          .map(digest),
      ),
  };
}

function repositoryOver(w: World): MemoryRepository {
  return {
    listLive: (
      _sql: unknown,
      tenantId: string,
      owner: { ownerContextId: string },
    ) =>
      Promise.resolve(
        w.memories.filter(
          (m) =>
            m.tenantId === tenantId &&
            m.ownerContextId === owner.ownerContextId &&
            (m.status === "active" || m.status === "confirmed"),
        ),
      ),
    markUsed: () => Promise.resolve(),
  } as unknown as MemoryRepository;
}

async function recallText(
  w: World,
  actor: ActorContext,
  utterance: string,
  options: { graph: boolean; companyIds?: string[] },
): Promise<string> {
  const service = createMemoryService({
    sql: tx.sql,
    transactions,
    repository: repositoryOver(w),
    conversations: digestPort(w),
    graph: options.graph ? portOver(w) : undefined,
    now: () => NOW,
  });
  const bundle = await service.recall({
    actor,
    conversationId: "30000000-0000-4000-8000-0000000000ff",
    companyIds: options.companyIds ?? [],
    utterance,
  });
  return renderMemoryBundle(bundle);
}

// --- The benchmark -----------------------------------------------------------

const Q1 =
  "Which companies we discussed in the last month match our mandate and have a memo, and what did the reviewer flag?";
const Q2 =
  "What changed about Tensorgate since our last assessment and which of my earlier concerns did the deck answer?";

/** Facts a correct answer needs, each as a line the prompt must carry. */
const Q1_GOLD: readonly RegExp[] = [
  /Tensorgate\n(?: {2}.*\n)*? {2}Mandate: ranked 2 in the current slate/u,
  /Kwara Grid\n(?: {2}.*\n)*? {2}Mandate: ranked 1 in the current slate/u,
  /Memo \(Q-prepared, Q inference\): "Tensorgate investment memo" v2/u,
  /Customer concentration in two design partners is not discussed/u,
  /Net revenue retention is asserted without a source/u,
  /Kwara Grid\n(?: {2}.*\n)*? {2}Documents: none of your organisation's on record/u,
  /Orbit Freight\n(?: {2}.*\n)*? {2}Mandate: not in the current slate/u,
];
/** What must never be in the answer to Q1. */
const Q1_FORBIDDEN: readonly RegExp[] = [
  /^- Lumen Pay$/mu, // discussed 50 days ago: not "last month"
  /Quietwater/u, // a colleague's company and memo
  /COLLEAGUE-ONLY/u,
  /another fund/iu, // another tenant's conversation
  /FOUNDER-PRIVATE|Cash 14 months/u, // the founder's own document
];
const Q2_GOLD: readonly RegExp[] = [
  /"Tensorgate investment memo" v2, 2026-10-03/u,
  /Since the latest document \(2026-10-03\): discussed again 2026-10-10; you said more on 2026-10-09/u,
  /You said \(2026-09-30, your words, not verified\): Worried Tensorgate's churn/u,
  /You said \(2026-10-09, your words, not verified\): Wants Tensorgate's lead investor/u,
  /Reviewer \(Q's reviewer, Q inference; 2026-10-03; on v1, revised to v2\)/u,
  /What is gross churn over the last twelve months\?/u,
];

function score(text: string, gold: readonly RegExp[]): number {
  return gold.filter((g) => g.test(text)).length;
}

describe("benchmark: multi-hop questions, before and after connected recall", () => {
  it("Q1 (discussed × mandate × memo × reviewer): baseline 0/7, after 7/7, nothing forbidden", async () => {
    const w = world();
    const before = await recallText(w, investor, Q1, { graph: false });
    const after = await recallText(w, investor, Q1, { graph: true });
    expect(score(before, Q1_GOLD)).toBe(0);
    if (process.env["CQ_GRAPH_BENCH_PRINT"] === "1") console.log(after);
    expect(score(after, Q1_GOLD)).toBe(Q1_GOLD.length);
    for (const bad of Q1_FORBIDDEN) {
      expect(after).not.toMatch(bad);
      expect(before).not.toMatch(bad);
    }
    expect(after.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
  });

  it("Q2 (Tensorgate since the memo × earlier concerns × reviewer × diligence): baseline 0/6, after 6/6", async () => {
    const w = world();
    // The turn is about Tensorgate (the run's subject), as from its profile.
    const before = await recallText(w, investor, Q2, {
      graph: false,
      companyIds: [TENSORGATE],
    });
    const after = await recallText(w, investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    // Today's recall already carries the two Tensorgate conversations and
    // the person's own words about it, but under other headings and with
    // no link to the memo, its date, the review or the questions.
    expect(score(before, Q2_GOLD)).toBe(0);
    expect(score(after, Q2_GOLD)).toBe(Q2_GOLD.length);
    // Focused on the turn's company: no other company is reported.
    expect(after).not.toMatch(/^- (?:Kwara Grid|Orbit Freight|Lumen Pay)$/mu);
    expect(after).not.toMatch(/FOUNDER-PRIVATE|another fund/u);
  });
});

// --- When it runs ------------------------------------------------------------

describe("code decides when a turn needs connected recall", () => {
  it("reads it for questions across linked things", () => {
    expect(planGraphRecall(Q1)?.windowDays).toBe(31);
    expect([...(planGraphRecall(Q1)?.cues ?? [])].sort()).toEqual(
      ["DISCUSSED", "DOCUMENT", "MANDATE", "REVIEW"].sort(),
    );
    expect(planGraphRecall(Q2, [TENSORGATE])).not.toBeNull();
    expect(
      planGraphRecall("What did the reviewer flag on my memos?"),
    ).not.toBeNull();
    expect(
      planGraphRecall("Memos from the last 10 days I discussed")?.windowDays,
    ).toBe(10);
  });

  it("reads none for a plain question, and none without a second link", async () => {
    expect(planGraphRecall("What is Tensorgate's runway?")).toBeNull();
    expect(planGraphRecall("Draft a memo")).toBeNull();
    expect(planGraphRecall("")).toBeNull();
    const calls: string[] = [];
    const service = createMemoryService({
      sql: tx.sql,
      transactions,
      repository: repositoryOver(world()),
      graph: portOver(world(), calls),
      now: () => NOW,
    });
    const bundle = await service.recall({
      actor: investor,
      utterance: "What is the weather in Lagos?",
    });
    expect(bundle.connected).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("never runs for a non-person actor", async () => {
    const calls: string[] = [];
    const service = createMemoryService({
      sql: tx.sql,
      transactions,
      repository: repositoryOver(world()),
      graph: portOver(world(), calls),
      now: () => NOW,
    });
    const bundle = await service.recall({
      actor: ActorContextSchema.parse({ ...investor, actorType: "Q" }),
      utterance: Q1,
    });
    expect(bundle.connected).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

// --- Permission boundaries ---------------------------------------------------

describe("every hop is the asking person's", () => {
  it("another person in the same organisation sees only their own", async () => {
    const text = await recallText(world(), colleague, Q1, { graph: true });
    expect(text).not.toMatch(
      /Tensorgate first look|Kwara Grid|Customer concentration/u,
    );
    expect(text).toMatch(/^- Quietwater$/mu);
  });

  it("another tenant sees none of Savanna's records", async () => {
    const text = await recallText(world(), otherTenant, Q1, { graph: true });
    expect(text).toContain(CONNECTED_LABEL);
    expect(text).not.toMatch(/Savanna|memo v2|Customer concentration|Kwara/u);
    // Their own conversation is not linked to any document or mandate of theirs.
    expect(text).toMatch(
      /Mandate fit: not known \(no single active mandate on record\)/u,
    );
  });

  it("the founder's private document never reaches the investor, and the investor's memo never reaches the founder", async () => {
    const investorText = await recallText(world(), investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    expect(investorText).not.toMatch(
      /FOUNDER-PRIVATE|Cash 14 months|runway plan/u,
    );
    const founderText = await recallText(
      world(),
      tensorgateFounder,
      "What did the reviewer flag on my memo about Tensorgate?",
      { graph: true, companyIds: [TENSORGATE] },
    );
    expect(founderText).not.toMatch(
      /Customer concentration|Tensorgate investment memo|Savanna/u,
    );
  });

  it("a revoked person (the port returns nothing) gets nothing", async () => {
    const empty: RecallGraphPort = {
      conversations: () => Promise.resolve([]),
      jobs: () => Promise.resolve([]),
      documents: () => Promise.resolve([]),
      mandateFit: () => Promise.resolve(null),
      companies: () => Promise.resolve([]),
    };
    const recall = await buildConnectedRecall({
      port: empty,
      actor: investor,
      plan: planGraphRecall(Q1) ?? { cues: new Set(), windowDays: 31 },
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    expect(recall.companies).toEqual([]);
    expect(renderConnectedRecall(recall)).toMatch(
      /Nothing of theirs on record connects/u,
    );
  });
});

// --- Corrections, freshness and history -------------------------------------

describe("corrections, freshness and history", () => {
  it("a superseded memory never appears; its replacement does", async () => {
    const w = world();
    w.memories = [
      memory({
        id: "50000000-0000-4000-8000-0000000000a1",
        content: "Tensorgate's churn is 5% a month",
        status: "superseded",
        supersededBy: "50000000-0000-4000-8000-0000000000a2",
        createdAt: daysAgo(15),
      }),
      memory({
        id: "50000000-0000-4000-8000-0000000000a2",
        content: "Correction: Tensorgate's churn is 1.5% a month",
        memoryType: "correction",
        createdAt: daysAgo(5),
      }),
    ];
    const text = await recallText(w, investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    expect(text).toContain("Correction: Tensorgate's churn is 1.5% a month");
    expect(text).not.toContain("churn is 5% a month");
  });

  it("a review is tied to the version it read, and says when the document moved on", async () => {
    const w = world();
    const memo = w.documents.find((d) => d.artifactId === MEMO_V2);
    if (memo === undefined) throw new Error("fixture");
    w.documents = w.documents.map((d) =>
      d.artifactId === MEMO_V2
        ? { ...d, version: 4, updatedAt: daysAgo(1) }
        : d,
    );
    const text = await recallText(w, investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    expect(text).toMatch(
      /on v1, revised to v2; the document has changed since \(now v4\)/u,
    );
    expect(text).toMatch(
      /Since the latest document \(2026-10-11\): nothing of yours on record/u,
    );
  });

  it("dates every line and labels what is over the stale bound", async () => {
    const recall = await buildConnectedRecall({
      port: portOver(world()),
      actor: investor,
      plan: { cues: new Set(["DOCUMENT", "REVIEW"]), windowDays: 365 },
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    const text = renderConnectedRecall(recall);
    expect(text).toMatch(
      new RegExp(
        `"Lumen Pay memo" v1, 2026-06-14, over ${String(GRAPH_STALE_DAYS)} days old`,
        "u",
      ),
    );
  });

  it("an unread facet is unknown, never none", async () => {
    const port = portOver(world());
    const recall = await buildConnectedRecall({
      port: { ...port, documents: () => Promise.reject(new Error("down")) },
      actor: investor,
      plan: planGraphRecall(Q1) ?? { cues: new Set(), windowDays: 31 },
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    const text = renderConnectedRecall(recall);
    expect(recall.unread).toEqual(["documents"]);
    expect(text).toMatch(/Documents: could not be read this time \(unknown\)/u);
    expect(text).not.toMatch(/none of your organisation's on record/u);
    expect(text).toMatch(
      /Not read this time \(unknown, not none\): documents\./u,
    );
  });

  it("a mandate without a current slate is fit unknown, not 'not in the slate'", async () => {
    const w = world();
    w.mandates = w.mandates.map((m) => ({
      ...m,
      companyIds: null,
      slateGeneratedAt: null,
    }));
    const text = await recallText(w, investor, Q1, { graph: true });
    expect(text).toMatch(
      /Mandate fit: not known \(no current slate for "Savanna Seed Fund I" v3\)/u,
    );
    expect(text).not.toMatch(/not in the current slate/u);
  });
});

// --- Bounds ------------------------------------------------------------------

describe("bounded", () => {
  it("is absent when the build exceeds its budget, and recall does not wait", async () => {
    const port = portOver(world());
    const slow: RecallGraphPort = {
      ...port,
      jobs: () => new Promise((resolve) => setTimeout(() => resolve([]), 500)),
    };
    const started = Date.now();
    const recall = await connectedRecallWithin(
      {
        port: slow,
        actor: investor,
        plan: planGraphRecall(Q1) ?? { cues: new Set(), windowDays: 31 },
        seedCompanyIds: [],
        memories: [],
        now: NOW,
      },
      30,
    );
    expect(recall).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("reports at most five companies and stays within its text bound", async () => {
    const w = world();
    for (let i = 0; i < 20; i += 1) {
      const id = `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      NAMES[id] = `Filler Company ${String(i)}`;
      w.conversations.push({
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: `70000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        title: `Filler ${String(i)}`,
        summary: "x".repeat(400),
        at: daysAgo(3),
        companyIds: [id],
      });
    }
    const recall = await buildConnectedRecall({
      port: portOver(w),
      actor: investor,
      plan: planGraphRecall(Q1) ?? { cues: new Set(), windowDays: 31 },
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    expect(recall.companies.length).toBeLessThanOrEqual(5);
    // Ranked by how many of the asked links hold: the two real answers first.
    expect(recall.companies.slice(0, 2).map((c) => c.name)).toEqual([
      "Tensorgate",
      "Kwara Grid",
    ]);
    expect(renderConnectedRecall(recall).length).toBeLessThanOrEqual(
      CONNECTED_MAX,
    );
  });

  it("names a company only as a whole word", () => {
    expect(namesCompany("We liked Kwara Grid's metering", "Kwara Grid")).toBe(
      true,
    );
    expect(namesCompany("Orbitals are not Orbit", "Orbit")).toBe(true);
    expect(namesCompany("Orbitals only", "Orbit")).toBe(false);
    expect(namesCompany("anything", "AB")).toBe(false);
  });
});

describe("an older review record", () => {
  it("that does not say whether it changed anything is unknown, not 'no change'", async () => {
    const w = world();
    w.jobs = w.jobs.map((j) =>
      j.review === null || j.userId !== investor.userId
        ? j
        : {
            ...j,
            review: { ...j.review, material: null, revisedToVersion: null },
          },
    );
    const text = await recallText(w, investor, Q1, { graph: true });
    expect(text).toMatch(
      /Reviewer \(Q's reviewer, Q inference; 2026-10-03; outcome not recorded\)/u,
    );
    expect(text).not.toMatch(/no material change needed|kept as written/u);
  });
});

// --- "What did we talk about last time?" (live defect 2026-10-13) -----------

describe("last-time recall covers recent distinct conversations and jobs", () => {
  const LEDGERFOLD = "10000000-0000-4000-8000-0000000000aa";
  const CURRENT = "30000000-0000-4000-8000-0000000000ff";
  function lastTimeWorld(): World {
    NAMES[LEDGERFOLD] = "Ledgerfold";
    const w = world();
    w.conversations = [
      // This conversation: its turn from a minute ago is all today's recall had.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: CURRENT,
        title: null,
        summary: "Asked Q what they talked about last time.",
        at: new Date(NOW - 60_000).toISOString(),
        companyIds: [],
      },
      // Earlier conversations the extractor never summarised.
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-0000000000b1",
        title: null,
        summary: null,
        at: daysAgo(1),
        companyIds: [LEDGERFOLD],
      },
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        conversationId: "30000000-0000-4000-8000-0000000000b2",
        title: "Pipeline review",
        summary: "Reviewed the energy pipeline; Kwara Grid first.",
        at: daysAgo(3),
        companyIds: [],
      },
      ...w.conversations.filter((c) => c.userId !== investor.userId),
    ];
    w.jobs = [
      {
        tenantId: SAVANNA_TENANT,
        userId: investor.userId,
        jobId: "40000000-0000-4000-8000-0000000000b1",
        goal: "Research Ledgerfold and write me a memo",
        state: "NEEDS_DECISION",
        finishedAt: daysAgo(1),
        updatedAt: daysAgo(1),
        conversationId: "30000000-0000-4000-8000-0000000000b1",
        documents: [],
        review: null,
        diligence: null,
      },
      ...w.jobs.filter((j) => j.userId !== investor.userId),
    ];
    return w;
  }
  const ASKED = "what did we talk about last time?";

  it("is planned by code for 'last time' wording alone", () => {
    expect(planGraphRecall(ASKED)?.cues.has("RECENT")).toBe(true);
    expect(planGraphRecall("Catch me up")?.cues.has("RECENT")).toBe(true);
    expect(planGraphRecall("Where did we leave it?")).not.toBeNull();
    expect(planGraphRecall("What did we discuss?")).not.toBeNull();
    expect(planGraphRecall("Last quarter's revenue?")).toBeNull();
  });

  it("baseline names only this conversation; after, the earlier ones and the Ledgerfold job, dated, newest first", async () => {
    const before = await recallText(lastTimeWorld(), investor, ASKED, {
      graph: false,
    });
    expect(before).toContain("Asked Q what they talked about last time.");
    expect(before).not.toMatch(/Ledgerfold/u);
    const after = await recallText(lastTimeWorld(), investor, ASKED, {
      graph: true,
    });
    expect(after).toContain(
      "- 2026-10-11 job (waiting for their decision): Research Ledgerfold and write me a memo",
    );
    expect(after).toContain(
      "- 2026-10-11 conversation [about Ledgerfold]: not summarised yet",
    );
    expect(after).toContain(
      '- 2026-10-09 conversation "Pipeline review": Reviewed the energy pipeline',
    );
    // This conversation is never listed as an earlier one, nor anyone else's.
    const section = after.split("\n\n")[0] ?? "";
    expect(section).not.toContain("Asked Q what they talked about last time.");
    expect(after).not.toMatch(/Quietwater|another fund|COLLEAGUE/u);
    // Only the conversations and jobs: no company section for this question.
    expect(after).not.toContain(CONNECTED_LABEL);
    // And the list is not repeated under "Other recent conversations".
    expect(after).not.toContain("Other recent conversations:");
  });

  it("with nothing earlier, says none on record; with a failed read, unknown", async () => {
    const empty: RecallGraphPort = {
      conversations: () => Promise.resolve([]),
      jobs: () => Promise.resolve([]),
      documents: () => Promise.resolve([]),
      mandateFit: () => Promise.resolve(null),
      companies: () => Promise.resolve([]),
    };
    const plan = planGraphRecall(ASKED) ?? { cues: new Set(), windowDays: 92 };
    const none = await buildConnectedRecall({
      port: empty,
      actor: investor,
      plan,
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    expect(renderConnectedRecall(none)).toMatch(
      /None on record in the last 92 days besides this conversation\./u,
    );
    const failed = await buildConnectedRecall({
      port: { ...empty, jobs: () => Promise.reject(new Error("down")) },
      actor: investor,
      plan,
      seedCompanyIds: [],
      memories: [],
      now: NOW,
    });
    expect(renderConnectedRecall(failed)).toMatch(
      /Could not be read this time \(unknown\)\./u,
    );
  });
});

describe("connected diligence wording and approval evidence", () => {
  it("preserves a complete canonical question, including its final qualifier", async () => {
    const w = world();
    const question =
      "Provide monthly revenue, cash balances, cost of funds, operating costs, loan losses and portfolio-at-risk definitions for eighteen months, with currency basis and denominators.";
    expect(question.length).toBeGreaterThan(140);
    expect(question.length).toBeLessThanOrEqual(180);
    const job = w.jobs[0];
    if (job === undefined || job.diligence === null)
      throw new Error("Missing fixture diligence");
    w.jobs[0] = {
      ...job,
      diligence: { questions: [question], filedForApproval: true },
    };
    const text = await recallText(w, investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    expect(text).toContain(question);
  });

  it("reports historical filing without inventing a still-pending approval", async () => {
    const text = await recallText(world(), investor, Q2, {
      graph: true,
      companyIds: [TENSORGATE],
    });
    expect(text).toContain(
      "filed for approval; current approval status not checked",
    );
    expect(text).not.toContain("waiting for your approval");
  });
});

describe("connected recall with several jobs for the same company", () => {
  it("keeps complete useful evidence when a company's history exceeds the budget", async () => {
    const w = world();
    const job = w.jobs[0];
    if (job === undefined) throw new Error("Missing fixture job");
    w.jobs = Array.from({ length: 6 }, (_, index) => ({
      ...job,
      jobId: `40000000-0000-4000-8000-00000000000${String(index + 1)}`,
    }));
    const recall = await buildConnectedRecall({
      port: portOver(w),
      actor: investor,
      plan: planGraphRecall(Q2, [TENSORGATE]) ?? {
        cues: new Set(["REVIEW"]),
        windowDays: 31,
      },
      seedCompanyIds: [TENSORGATE],
      memories: [],
      now: NOW,
    });
    expect(renderConnectedRecall(recall, 10_000).length).toBeGreaterThan(
      CONNECTED_MAX,
    );
    const bounded = renderConnectedRecall(recall);
    expect(bounded.length).toBeLessThanOrEqual(CONNECTED_MAX);
    expect(bounded).toContain("Tensorgate investment memo");
    expect(bounded).toContain(
      "Net revenue retention is asserted without a source",
    );
    expect(bounded).not.toMatch(/…$/u);
  });
});

describe("bounded recall preserves incomplete-evidence disclosures", () => {
  async function oversizedRecall() {
    const recall = await buildConnectedRecall({
      port: portOver(world()),
      actor: investor,
      plan: { cues: new Set(["REVIEW" as const]), windowDays: 31 },
      seedCompanyIds: [TENSORGATE],
      memories: [],
      now: NOW,
    });
    const company = recall.companies[0];
    const review = company?.reviews[0];
    if (company === undefined || review === undefined)
      throw new Error("Missing connected review fixture");
    return {
      ...recall,
      unread: ["jobs" as const, "mandate" as const],
      companies: [
        {
          ...company,
          reviews: [
            {
              ...review,
              issues: Array.from({ length: 20 }, (_, index) => ({
                kind: "UNSUPPORTED",
                section: "Financials",
                problem: `Issue ${String(index)}: ${"missing source ".repeat(12)}`,
              })),
            },
          ],
        },
        {
          ...company,
          name: "Later company",
          reviews: [],
          diligence: [],
          said: [],
        },
      ],
    };
  }

  it("retains attributed reviewer evidence, a later company, and failed-read disclosure", async () => {
    const text = renderConnectedRecall(await oversizedRecall());
    expect(text.length).toBeLessThanOrEqual(CONNECTED_MAX);
    expect(text).toContain("Reviewer (Q's reviewer, Q inference;");
    expect(text).toContain("Issue 0:");
    expect(text).toContain("- Later company");
    expect(text).toContain(
      "Not read this time (unknown, not none): jobs, mandate.",
    );
    expect(text).toContain("Some recorded evidence omitted");
    expect(text).not.toMatch(/…$/u);
  });

  it("a long recent section cannot displace the company evidence or disclosures", async () => {
    const recall = await oversizedRecall();
    const text = renderConnectedRecall({
      ...recall,
      recent: Array.from({ length: 10 }, (_, index) => ({
        kind: "JOB" as const,
        at: "2026-10-12",
        jobId: `job-${String(index)}`,
        goal: "Long historical work ".repeat(20),
        state: "COMPLETED",
      })),
    });
    expect(text.length).toBeLessThanOrEqual(CONNECTED_MAX);
    expect(text).toContain("- Later company");
    expect(text).toContain("Memo (Q-prepared, Q inference)");
    expect(text).toContain(
      "Not read this time (unknown, not none): jobs, mandate.",
    );
    expect(text).toContain("Some recorded evidence omitted");
  });

  it("never emits over-budget or clipped evidence at small budgets", async () => {
    const recall = await oversizedRecall();
    for (const budget of [0, 1, 10, 43, 44, 100, 250, 400, 600, 1_000, 2_000]) {
      const text = renderConnectedRecall(recall, budget);
      expect(text.length).toBeLessThanOrEqual(budget);
      if (text.length > 0) expect(text).toContain("unknown");
    }
  });
});
