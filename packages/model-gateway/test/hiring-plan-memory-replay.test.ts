import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { AuthorisedFact, CompanyAnalystResult } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type FakeBehaviour,
} from "../src/index.js";
import { checkAnswer, claimCorpus } from "../src/q/claim-check.js";
import { documentRowFacts, documentTables } from "../src/q/document-rows.js";
import {
  listedDocumentsOf,
  sharedDocumentReads,
} from "../src/q/shared-documents.js";
import {
  createModelGatewayQAnswer,
  type QMemoryRecall,
  type QMemoryRecalled,
  type QSummaryCorrection,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";
import {
  BANK_STATEMENT_READ,
  DATA_ROOM_READ,
  MANAGEMENT_ACCOUNTS_READ,
  PLAN_CHUNKS,
} from "./live-91bb8564-fixture.js";

/**
 * Live re-check on production a65386689 (16 Nov 2026, 21:33 UTC),
 * conversation 2a26d43b, Thames Arc's investor:
 *
 *   T1 (run 91bb8564) "What hiring does Halyard Security have planned for
 *      2027, by role?" -> "... 15 people ...: 5 in Q1, 10 in Q2 and 1 in
 *      Q3. The roles are 4 public-sector account managers and 1 ..."
 *   T2 (run 9c8c6709, ANSWER_FROM_CONTEXT, the evidence of T1 reused)
 *      "And when does each of those groups start?"
 *
 * The plan's row says 3 account managers; its Q1 rows add up to 4. The
 * c6ba4d0f2 row binding ran on this answer (the stored run's checks:
 * claimCheck runs 2, claimCheckAnswer runs 1, nothing ungrounded) and
 * held: what defeated it was a second source naming the item with a 4.
 * Memory recall rendered Q's own replies and summaries from two earlier
 * conversations about the same plan (8811f9c7, e7e3c866: "Q said: ... 4
 * public-sector account managers ...", "Q1 includes four public-sector
 * account managers ...") into the task message, which the check read as
 * a source like any document, so the wrong count was bound to Q's own
 * earlier words. And "5 in Q1" is a count of a quarter, which no check
 * held to the table at all.
 *
 * Replayed through the answer entry with a fake model and the run's real
 * stored tool output and passages (live-91bb8564-fixture.ts); the memory
 * text is the earlier conversations' stored Q replies and summaries in
 * recall's rendering. No provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const THAMES_ARC = "cfbc217a-5ba2-407f-a684-084a96d892f7";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";

const RETRIEVED: readonly AuthorisedFact[] = PLAN_CHUNKS.map((statement) => ({
  scope: "COMPANY_DOCUMENTS",
  statement,
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
  source: "Team and hiring plan, page 1",
}));

const GREETING =
  "Welcome back, Amelia. Worth a look. 12 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";
const Q1 = "What hiring does Halyard Security have planned for 2027, by role?";
/** T1's stored reply, word for word. */
const T1_LIVE =
  "Halyard Security plans to hire 15 people in 2027, conditional on the seed round closing: 5 in Q1, 10 in Q2 and 1 in Q3. The roles are 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan identifies quarters, not individual start dates.";
const Q2 = "And when does each of those groups start?";
/** T2's stored reply, word for word (it states no count). */
const T2_LIVE =
  "Each hiring group is planned to start in a quarter, rather than on a specific month or day. The public-sector account managers and information security and assurance manager start in Q1 2027; the deployment engineers and product engineers start in Q2 2027; and the finance and operations manager starts in Q3 2027. The plan is conditional on the seed round closing.";
/** A follow-up that repeats the counts (as e7e3c866's T2 did). */
const T2_REPEATS =
  "Q1 2027 is 4 public-sector account managers and 1 information security and assurance manager; Q2 2027 is 6 deployment engineers and 4 product engineers; Q3 2027 is 1 finance and operations manager.";

/** Q's stored replies in the two earlier conversations about the plan. */
const EARLIER_Q_REPLIES = [
  "Halyard Security’s hiring plan names five 2027 groups, adding 15 people in total if the planned seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan does not give a specific month or day within each quarter. These are projected hires, not actual results.\n\nWant me to ask Halyard Security for a document that would settle this? I'll prepare the request for your approval.",
  "Halyard Security is planning to hire 15 people next year, assuming the planned seed round closes. The roles are 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. These are projected hires, not actual results, and the plan does not specify individual months or days.",
  "Halyard Security’s planned hiring groups start in Q1, Q2 and Q3 of 2027: Q1 is 4 public-sector account managers and 1 information security and assurance manager; Q2 is 6 deployment engineers and 4 product engineers; Q3 is 1 finance and operations manager. The plan is conditional on the seed round closing and does not specify individual months or days.",
];
/** Their stored summaries (q_runtime.conversation_summary_revisions). */
const EARLIER_SUMMARIES = [
  "Amelia asked which quarter each planned Halyard Security hiring group starts. Q reported that the 15 planned hires are scheduled for Q1, Q2 and Q3 of 2027: Q1 includes four public-sector account managers and one information security and assurance manager; Q2 includes six deployment engineers and four product engineers; Q3 includes one finance and operations manager. The plan is conditional on the seed round closing and does not specify individual months or days.",
  "Amelia asked how Halyard Security’s 2027 hiring plan breaks down by role and start quarter. The plan projects 15 hires if the seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. It does not specify months or days, and the hires are projections rather than actual results. Amelia has not yet decided whether to request further documentation.",
];

/** The plan read as pages, as the shared-document read returns it. */
const PLAN_READ = {
  ...MANAGEMENT_ACCOUNTS_READ,
  pages: [{ page: 1, text: PLAN_CHUNKS.join("\n") }],
  title: "Team and hiring plan",
  folder: "Team",
  pageCount: 1,
  documentId: "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef",
};
/** Which documents a turn read as pages, in order. */
const pagesRead: string[] = [];

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Recall's rendering (q-knowledge memory/render.ts) of those turns. */
const MEMORY_T1 = [
  'Their own earlier conversations, word for word (what was said, not verified evidence; "they said" lines are their own words, "Q said" lines are Q\'s):',
  ...EARLIER_Q_REPLIES.map(
    (reply) =>
      `- 2026-11-16 (in "Halyard Security hiring plan"), Q said: "${clip(reply.replace(/\s+/gu, " ").trim(), 320)}"`,
  ),
  "",
  "Earlier conversations about what they asked (what was discussed, not verified evidence):",
  ...EARLIER_SUMMARIES.map(
    (summary) =>
      `- 2026-11-16 Halyard Security hiring plan: ${clip(summary, 600)}`,
  ),
].join("\n");
/** T2 recalls this conversation too: its own summary of T1, as Q wrote it. */
const MEMORY_T2 = `${MEMORY_T1}\n\nEarlier in this conversation (Halyard Security 2027 hiring plan):\nAmelia asked about Halyard Security's 2027 hiring by role. Q reported 15 planned hires: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3.`;

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: `${name}.`,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

const TOOLS: readonly QOfferedTool[] = [
  offered("read_my", "app.own.read"),
  offered("list_my_relationships", "relationship.own.list"),
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("get_relationship", "relationship.get"),
  offered("read_company_data_room", "company.data_room.read"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
  offered("list_schedule", "schedule.list"),
  offered("list_pending_approvals", "approvals.pending.list"),
  offered("list_q_work", "q.work.list"),
];

function outcomeOf(proposal: QToolProposal, data: unknown): QToolCallOutcome {
  const tool = TOOLS.find((one) => one.definition.name === proposal.name);
  return data === null
    ? {
        callId: proposal.callId,
        toolName: tool?.toolName ?? proposal.name,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "DENIED",
        failureCode: "NOT_AVAILABLE",
        sensitivity: null,
        result: {
          ok: false,
          error: { code: "NOT_AVAILABLE", safeMessage: "Not available." },
        },
        latencyMs: 1,
      }
    : {
        callId: proposal.callId,
        toolName: tool?.toolName ?? proposal.name,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: { ok: true, data },
        latencyMs: 2,
      };
}

function toolsFor(): QToolPort {
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "list_my_relationships":
        return {
          relationships: [
            {
              relationshipId: "5e000000-0000-4000-8000-0000000000d8",
              counterpart: {
                kind: "COMPANY",
                id: HALYARD,
                name: "Halyard Security",
              },
              state: "IN_DILIGENCE",
              stateSince: "2026-11-16T15:00:00.000Z",
              nextStep: "NONE",
              messagesRead: "OK",
              lastMessage: null,
            },
          ],
        };
      case "search_companies":
        return {
          items:
            String(args["query"]).toLowerCase() === "halyard security"
              ? [{ companyId: HALYARD, canonicalName: "Halyard Security" }]
              : [],
          nextCursor: null,
        };
      case "get_company":
        return {
          companyId: HALYARD,
          canonicalName: "Halyard Security",
          currentStageCode: "seed",
          relationToYou: "SHARED",
        };
      case "read_company_figures":
        return { companyId: HALYARD, status: "AVAILABLE", figures: [] };
      case "read_company_data_room":
        return DATA_ROOM_READ;
      case "read_document_pages":
        pagesRead.push(String(args["documentId"]));
        return args["documentId"] === PLAN_READ.documentId
          ? PLAN_READ
          : args["documentId"] === BANK_STATEMENT_READ.documentId
            ? BANK_STATEMENT_READ
            : MANAGEMENT_ACCOUNTS_READ;
      case "list_schedule":
        return { items: [] };
      case "list_pending_approvals":
        return { approvals: [] };
      case "list_q_work":
        return { work: [] };
      default:
        return null;
    }
  };
  return {
    offer: () => Promise.resolve(TOOLS),
    available: () => Promise.resolve(TOOLS),
    execute: (proposal) =>
      Promise.resolve(outcomeOf(proposal, respond(proposal))),
  };
}

function analyst(answer: string): CompanyAnalystResult {
  return {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  };
}

function plan(): PermittedContextPlan {
  return {
    ...PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: THAMES_ARC,
        },
      },
    ],
  } as unknown as PermittedContextPlan;
}

async function turn(
  history: readonly { readonly role: "USER" | "Q"; readonly content: string }[],
  modelSays: string,
  memory: string | QMemoryRecalled,
  executionClass?: "ANSWER_FROM_CONTEXT",
  supersedeSummaries?: QMemoryRecall["supersedeSummaries"],
  /** What retrieval held (live 434ead80: nothing). */
  retrieved: readonly AuthorisedFact[] = RETRIEVED,
) {
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      { kind: "TEXT", text: JSON.stringify(analyst(modelSays)) },
    ] satisfies readonly FakeBehaviour[],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([fake]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const started = Date.parse("2026-11-16T21:33:17.000Z");
  const messages: QConversationMessage[] = history.map(
    (message, index) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: CONVERSATION,
        runId: RUN,
        role: message.role,
        content: message.content,
        contentType: "TEXT",
        ...(message.role === "Q" && index > 0
          ? { blocks: [{ kind: "COMPANY_REFERENCE", companyId: HALYARD }] }
          : {}),
        createdAt: new Date(started + index * 8_000).toISOString(),
      }) as unknown as QConversationMessage,
  );
  const completed: { message: { text: string } }[] = [];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { role: "USER" | "Q"; content: string },
      ) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: input.role,
          content: input.content,
        } as QConversationMessage;
        messages.push(message);
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (
        _tx: unknown,
        input: { eventType?: string; payload?: unknown },
      ) => {
        if (input.eventType === "q.message.completed") {
          completed.push(input.payload as { message: { text: string } });
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: toolsFor(),
    // What recall handed the live prompt: Q's own earlier words.
    memory: {
      recall: () => Promise.resolve(memory),
      ...(supersedeSummaries === undefined ? {} : { supersedeSummaries }),
    },
    // The plan's text reached the live answers as retrieved passages.
    context: {
      assemble: () =>
        Promise.resolve({
          facts: [...retrieved],
          subjectDescription: `${String(retrieved.length)} passage(s) retrieved from source documents you are authorised to use; each is source material, not verified fact`,
        }),
    },
  });
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    askerSide: "INVESTOR",
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(),
    turnKind: "QUESTION_TO_Q",
    questionKind: "THEIR_OWN_RECORDS",
    aboutNamedOther: true,
    namedOther: { kind: "COMPANY", name: "Halyard Security" },
    research: Promise.resolve({ mode: "NEVER", announceSourceChange: false }),
    ...(executionClass === undefined ? {} : { executionClass }),
  } as unknown as QAnswerRequest;
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  return { outcome, said: completed.at(-1)?.message.text ?? "" };
}

const T1_HISTORY = [
  { role: "Q", content: GREETING },
  { role: "USER", content: Q1 },
] as const;
const T2_HISTORY = [
  ...T1_HISTORY,
  { role: "Q", content: T1_LIVE },
  { role: "USER", content: Q2 },
] as const;

describe("live re-check on a65386689: Halyard's hiring plan, with Q's earlier conversations recalled (run 91bb8564)", () => {
  it("T1: the account managers' count is the row's, and Q1's count is the rows starting then", async () => {
    const { outcome, said } = await turn(T1_HISTORY, T1_LIVE, MEMORY_T1);
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).not.toContain("4 public-sector account managers");
    expect(said).toContain("3 public-sector account managers");
    expect(said).not.toContain("5 in Q1");
    expect(said).toContain("hire 15 people in 2027");
    expect(said).toContain("4 in Q1, 10 in Q2 and 1 in Q3");
    expect(said).toContain("6 deployment engineers and 4 product engineers");
  });

  it("T2 (ANSWER_FROM_CONTEXT): Q's own earlier reply and this conversation's summary ground no count", async () => {
    const live = await turn(
      T2_HISTORY,
      T2_LIVE,
      MEMORY_T2,
      "ANSWER_FROM_CONTEXT",
    );
    expect(live.said).toContain("start in Q1 2027");
    const repeated = await turn(
      T2_HISTORY,
      T2_REPEATS,
      MEMORY_T2,
      "ANSWER_FROM_CONTEXT",
    );
    expect(repeated.said).not.toContain("4 public-sector account managers");
  });
});

describe("the table's rows, read by code", () => {
  const today = new Date("2026-11-16T21:33:00Z");

  it("the live passage's rows: wrapped roles, a cut-off parenthesis, a count before its quarter", () => {
    const plan = PLAN_CHUNKS.find((chunk) =>
      chunk.startsWith("Hiring plan funded by the seed round"),
    );
    expect(plan).toBeDefined();
    expect(documentTables(plan ?? "")).toEqual([
      {
        rows: [
          { label: "Deployment engineer", count: 6, period: "2027-Q2" },
          { label: "Product engineer", count: 4, period: "2027-Q2" },
          {
            label: "Public-sector account manager",
            count: 3,
            period: "2027-Q1",
          },
          {
            label: "Information security and assurance manager",
            count: 1,
            period: "2027-Q1",
          },
          {
            label: "Finance and operations manager",
            count: 1,
            period: "2027-Q3",
          },
        ],
      },
    ]);
  });

  it("a passage with a count table gets its rows as a fact beside it; a series does not", () => {
    const rows = documentRowFacts(RETRIEVED);
    const statements = rows.map((fact) => fact.statement);
    const hiring = statements.find((one) =>
      one.includes("Public-sector account manager: 3 (starts 2027-Q1)"),
    );
    expect(hiring).toContain("Starting 2027-Q1: 4 in all");
    expect(hiring).toContain("These rows add up to 15");
    // The month-by-month headcount series are not item rows.
    expect(statements.join("\n")).not.toMatch(/Engineering: [5-8]\b/u);
    // The headcount at 31 Oct adds up to its own Total row (23).
    expect(statements.join("\n")).toContain("Engineering: 9");
  });

  it("Q's own earlier words, recalled, bind no count; the document's row does", () => {
    const corpus = claimCorpus([...PLAN_CHUNKS, Q1], today, [MEMORY_T1]);
    const out = checkAnswer(T1_LIVE, corpus);
    expect(out.text).toContain("3 public-sector account managers");
    expect(out.text).toContain("4 in Q1, 10 in Q2 and 1 in Q3");
  });

  it("a quarter's count put right only where the quarters then add up to the stated head count", () => {
    const corpus = claimCorpus([...PLAN_CHUNKS], today);
    const out = checkAnswer(
      "Halyard plans to hire 16 people: 5 in Q1, 10 in Q2 and 1 in Q3.",
      corpus,
    );
    expect(out.text).not.toContain("5 in Q1");
    expect(out.text).not.toContain("4 in Q1");
    expect(
      checkAnswer("Halyard plans 5 new hires in Q1 2027.", corpus).text,
    ).not.toContain("5 new hires");
    expect(
      checkAnswer("Halyard plans 4 people in Q1 2027.", corpus).text,
    ).toContain("4 people in Q1 2027");
  });

  it("a finding with a count in words the rows contradict is left out", () => {
    const corpus = claimCorpus([...PLAN_CHUNKS], today);
    expect(
      checkAnswer(
        "Halyard Security plans to recruit four public-sector account managers in Q1 2027.",
        corpus,
      ).text,
    ).not.toContain("four public-sector");
    expect(
      checkAnswer(
        "Halyard Security plans to recruit three public-sector account managers in Q1 2027.",
        corpus,
      ).text,
    ).toContain("three public-sector");
  });
});

/**
 * Thames Arc, 16 Nov 2026, after 827cc7763: Q's wrong counts still sat in
 * the earlier conversations' stored summaries (8811f9c7, e7e3c866: "4" and
 * "four public-sector account managers"; 28071f0c: "five in Q1") and were
 * recalled into later conversations. Recall now labels each summary as
 * what Q said earlier; the answer still takes the row's count; and every
 * recalled summary the plan's rows contradict is handed back to be
 * superseded, with its counts put right, while one that agrees with the
 * plan is left alone.
 */
const STALE_FIVE =
  "Amelia asked for a role-by-role walkthrough of Halyard Security’s planned 2027 hiring. Q reported 15 conditional hires, dependent on the seed round closing: five in Q1, ten in Q2, and one in Q3 2027. Specific months and days remain unspecified.";
const AGREEING =
  "Amelia asked when each planned Halyard Security hiring group would start. Q clarified that the public-sector account managers and information security and assurance manager are planned for Q1 2027, deployment and product engineers for Q2 2027, and the finance and operations manager for Q3 2027, conditional on the seed round closing. Specific months and days remain unspecified.";
const RECALLED_SUMMARIES = [
  {
    conversationId: "8811f9c7-9d7a-42f6-9cae-4ae22c069a08",
    summary: EARLIER_SUMMARIES[1] ?? "",
  },
  {
    conversationId: "e7e3c866-46d4-4982-a799-d839c6ab2fed",
    summary: EARLIER_SUMMARIES[0] ?? "",
  },
  {
    conversationId: "28071f0c-b1e1-45c6-b68c-2e089c5a385b",
    summary: STALE_FIVE,
  },
  {
    conversationId: "2a26d43b-a752-4888-a8e4-b4997feea592",
    summary: AGREEING,
  },
];
/** Recall's rendering now: each summary says it is what Q said earlier. */
const MEMORY_LABELLED = [
  "Earlier conversations about what they asked (what was discussed, not verified evidence):",
  ...RECALLED_SUMMARIES.map(
    (s) =>
      `- 2026-11-16 Halyard Security hiring plan: Q said earlier (its summary, not a source) — ${clip(s.summary, 600)}`,
  ),
].join("\n");
const RECALLED: QMemoryRecalled = {
  text: MEMORY_LABELLED,
  ownWords: [],
  earlierSummaries: RECALLED_SUMMARIES,
};

describe("Thames Arc: an earlier summary holding Q's wrong count is Q's earlier statement, and is superseded", () => {
  it("the answer uses the row's 3, and each contradicted summary comes back put right", async () => {
    const superseded: QSummaryCorrection[] = [];
    const { outcome, said } = await turn(
      T1_HISTORY,
      T1_LIVE,
      RECALLED,
      undefined,
      ({ corrections }) => {
        superseded.push(...corrections);
        return Promise.resolve();
      },
    );
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).toContain("3 public-sector account managers");
    expect(said).not.toContain("4 public-sector account managers");

    const byId = new Map(superseded.map((c) => [c.conversationId, c]));
    expect([...byId.keys()].sort()).toEqual([
      "28071f0c-b1e1-45c6-b68c-2e089c5a385b",
      "8811f9c7-9d7a-42f6-9cae-4ae22c069a08",
      "e7e3c866-46d4-4982-a799-d839c6ab2fed",
    ]);
    for (const correction of superseded) {
      const stale = RECALLED_SUMMARIES.find(
        (s) => s.conversationId === correction.conversationId,
      );
      // What it was computed from, so a summary that moved on is left alone.
      expect(correction.from).toBe(stale?.summary);
      expect(correction.summary).not.toMatch(/\b(?:4|four) public-sector/iu);
      expect(correction.summary).not.toMatch(/\bfive in Q1\b/iu);
    }
    expect(byId.get("8811f9c7-9d7a-42f6-9cae-4ae22c069a08")?.summary).toContain(
      "3 public-sector account managers",
    );
    // "five in Q1" is put right or its sentence goes (checked above); the
    // rest of the summary stays.
    expect(byId.get("28071f0c-b1e1-45c6-b68c-2e089c5a385b")?.summary).toContain(
      "Specific months and days remain unspecified.",
    );
  });

  it("a summary that agrees with the plan is never superseded", async () => {
    const superseded: QSummaryCorrection[] = [];
    await turn(
      T2_HISTORY,
      T2_LIVE,
      RECALLED,
      "ANSWER_FROM_CONTEXT",
      ({ corrections }) => {
        superseded.push(...corrections);
        return Promise.resolve();
      },
    );
    expect(superseded.map((c) => c.conversationId)).not.toContain(
      "2a26d43b-a752-4888-a8e4-b4997feea592",
    );
  });
});

/**
 * Live on 827cc7763 (17 Nov 2026), Thames Arc, new conversation 1de1cf20:
 *
 *   run 434ead80 "Break down Halyard Security's planned 2027 hires for me"
 *     -> "Q1 2027: 4 public-sector account managers and 1 information
 *        security and assurance manager — 5 hires." The claim check:
 *        sources {facts 44, retrieved 0, documentRows 0, memory 1,
 *        earlierReplies 1}, corpus {tables 0}, answer {examined 5, bound 0,
 *        unplaced 5}. The data room listing held "Team and hiring plan"
 *        (shared with you), but the turn read the management accounts and
 *        the KPI pack; no passage of the plan was retrieved.
 *   run 2b4011a0 "So how many join in Q1?" -> "Five ... four public-sector
 *     account managers", again with no table in any source.
 *
 * The answer was built from recall alone: the four earlier conversations'
 * summaries and Q's earlier replies (stored, read-only, above). Now the
 * turn reads the plan, whose rows settle the counts; and where no source
 * names an item, a count only Q's own earlier words name is withheld.
 */
const Q_434 = "Break down Halyard Security's planned 2027 hires for me";
const LIVE_434 =
  "Halyard Security’s planned 2027 hiring is conditional on the seed round closing: 15 roles in total.\n\n- Q1 2027: 4 public-sector account managers and 1 information security and assurance manager — 5 hires.\n- Q2 2027: 6 deployment engineers and 4 product engineers — 10 hires.\n- Q3 2027: 1 finance and operations manager — 1 hire.\n\nThe plan gives quarters, not specific months or days. These are planned hires, not confirmed appointments.";
const LIVE_2B40 =
  "Five planned hires join Halyard Security in Q1 2027: four public-sector account managers and one information security and assurance manager. The plan is conditional on the seed round closing, and it gives the quarter rather than specific start dates.";
/** What recall held for 434ead80: Q's earlier replies and the summaries. */
const MEMORY_434 = [
  'Their own earlier conversations, word for word (what was said, not verified evidence; "they said" lines are their own words, "Q said" lines are Q\'s):',
  ...EARLIER_Q_REPLIES.map(
    (reply) =>
      `- 2026-11-16 (in "Halyard Security hiring plan"), Q said: "${clip(reply.replace(/\s+/gu, " ").trim(), 320)}"`,
  ),
  "",
  MEMORY_LABELLED,
].join("\n");
const RECALLED_434: QMemoryRecalled = {
  text: MEMORY_434,
  ownWords: [],
  earlierSummaries: RECALLED_SUMMARIES,
};

describe("live 434ead80: nothing retrieved, the answer built from Q's recalled earlier words", () => {
  it("the turn reads the shared hiring plan, and its count is the row's", async () => {
    pagesRead.length = 0;
    const superseded: QSummaryCorrection[] = [];
    const { outcome, said } = await turn(
      [
        { role: "Q", content: GREETING },
        { role: "USER", content: Q_434 },
      ],
      LIVE_434,
      RECALLED_434,
      undefined,
      ({ corrections }) => {
        superseded.push(...corrections);
        return Promise.resolve();
      },
      [],
    );
    expect(outcome.kind).toBe("ANSWERED");
    expect(pagesRead).toContain(PLAN_READ.documentId);
    expect(said).not.toMatch(/\b(?:4|four) public-sector/iu);
    // The stale summaries are superseded once the plan's rows are read.
    expect(superseded.map((c) => c.conversationId)).toContain(
      "8811f9c7-9d7a-42f6-9cae-4ae22c069a08",
    );
  });

  it("the document whose title names what was asked is read first", () => {
    const listed = listedDocumentsOf(DATA_ROOM_READ) ?? [];
    const reads = sharedDocumentReads({
      documents: listed,
      question: Q_434,
      alreadyRead: new Set(),
    });
    expect(reads[0]?.title).toBe("Team and hiring plan");
    // A figures question still reads the accounts first.
    expect(
      sharedDocumentReads({
        documents: listed,
        question: "What is Halyard Security's burn and runway?",
        alreadyRead: new Set(),
      })[0]?.title,
    ).toBe("Management accounts, May 2025 to Oct 2026");
  });

  it("with no source naming the roles, a count only Q's earlier words name is withheld", () => {
    const corpus = claimCorpus(
      [GREETING, "So how many join in Q1?"],
      new Date("2026-11-17T00:17:00Z"),
      [MEMORY_434, LIVE_434],
    );
    const checked = checkAnswer(LIVE_2B40, corpus);
    expect(checked.text).not.toMatch(/\b(?:4|four) public-sector/iu);
    // Q's earlier words alone never stand in for the document.
    const unrelated = checkAnswer(
      "Halyard Security has 4 public-sector account managers.",
      claimCorpus(["Halyard Security has 4 public-sector account managers."]),
    );
    expect(unrelated.text).toContain("4 public-sector account managers");
  });
});
