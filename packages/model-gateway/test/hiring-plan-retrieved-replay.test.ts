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
import { readNamedGateqApplications } from "../src/q/gateq-application-fact.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live re-check on 927f25ddd (16 Nov 2026, 19:39 UTC), a new conversation
 * (e7e3c866) for Thames Arc's investor:
 *
 *   T1 (run 9604481f) "How many people is Halyard Security planning to
 *      hire next year, and in which roles?" -> "... planning to hire 15
 *      people ... The roles are 4 public-sector account managers and 1
 *      information security and assurance manager in Q1; ..."
 *   T2 (run 875c410f) "Which quarter does each group start?" -> "... Q1 is
 *      4 public-sector account managers ..." again.
 *
 * The plan ("Team and hiring plan", c0d522b1) says 3. Neither run read the
 * document through a tool: its text reached the answer as retrieved
 * passages (q_knowledge.chunks of version 876b3b30, below verbatim: a
 * synthetic demo document). The 927f25ddd check missed it three ways:
 *   1. the total ("15 people") was in the sentence before the parts, so
 *      no total held the corrected count, and the count was not checked
 *      against the row at all once any line naming the item carried a 4
 *      anywhere along it (a long line, or Q's own earlier reply);
 *   2. on T2 Q's own T1 answer, among the sources, named the item with
 *      its own wrong 4 -- Q's earlier words grounded themselves;
 *   3. "1 information security and assurance manager" is wrapped across
 *      two table lines in the extracted text, so no line named it.
 * Replayed through the answer entry with a fake model; no provider, no
 * network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const THAMES_ARC = "cfbc217a-5ba2-407f-a684-084a96d892f7";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const APPLICATION = "0490be41-8918-4d61-9d1c-1d2aad045345";
const KPI_ID = "ebdded05-8b00-4e9b-932a-32e87829ac50";
const ACCOUNTS_ID = "7d1605cc-060f-491f-8ca1-b579045e2ccf";
const PLAN_ID = "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef";

/** The retrieved chunks of the plan (version 876b3b30), verbatim. */
const PLAN_CHUNKS: readonly string[] = [
  "Team and hiring plan\n\nHalyard Security Ltd | Period: May 2025 to Dec 2027 | Version 1.0 | Issued 13 Nov 2026",
  "Headcount at 31 Oct 2026\n\nFunction | People\n\nEngineering | 9\n\nDeployment | 9\n\nSales | 3\n\nOperations | 2\n\nTotal | 23",
  "Headcount by function: May 2026 to Oct 2026\n\nMay 2026 | Jun 2026 | Jul 2026 | Aug 2026 | Sep 2026 | Oct 2026\n\nEngineering | 8 | 9 | 9 | 9 | 9 | 9\n\nDeployment | 6 | 6 | 7 | 7 | 7 | 9\n\nSales | 3 | 3 | 3 | 3 | 3 | 3\n\nOperations | 2 | 2 | 2 | 2 | 2 | 2\n\nTotal | 19 | 20 | 21 | 21 | 21 | 23",
  "Hiring plan funded by the seed round\n\nRole | Function | People Start by | Use of funds line\n\nDeployment engineer | Deployment | 6 2027-Q2 | Deployment team for NHS trusts and councils\n\nProduct engineer (shared workstations, Engineering | 4 2027-Q2 | Product: shared workstation and lost-device flows\n\nlost devices)\n\nPublic-sector account manager | Sales | 3 2027-Q1 | Public-sector sales and framework listings\n\nInformation security and assurance | Operations | 1 2027-Q1 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nmanager | G&A\n\nFinance and operations manager | Operations | 1 2027-Q3 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and\n\nG&A",
  "SYNTHETIC DEMO DOCUMENT\n\nHalyard Security Ltd | Team and hiring plan Version 1.0 | Period: May 2025 to Dec 2027 | Issued 13 Nov 2026 | Page 1/1",
];

const RETRIEVED: readonly AuthorisedFact[] = PLAN_CHUNKS.map((statement) => ({
  scope: "COMPANY_DOCUMENTS",
  statement,
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
  source: "Team and hiring plan, p. 1",
}));

const Q1 =
  "How many people is Halyard Security planning to hire next year, and in which roles?";
/** T1's prose, word for word (the 4 is the wrong figure). */
const T1_LIVE =
  "Halyard Security is planning to hire 15 people next year, assuming the planned seed round closes. The roles are 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. These are projected hires, not actual results, and the plan does not specify individual months or days.";
const Q2 = "Which quarter does each group start?";
/** T2's prose, word for word. */
const T2_LIVE =
  "Halyard Security’s planned hiring groups start in Q1, Q2 and Q3 of 2027: Q1 is 4 public-sector account managers and 1 information security and assurance manager; Q2 is 6 deployment engineers and 4 product engineers; Q3 is 1 finance and operations manager. The plan is conditional on the seed round closing and does not specify individual months or days.";
const GREETING =
  "Welcome back, Amelia. Worth a look. 12 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";

const ROOM = {
  viewer: "INVESTOR",
  documents: [
    [ACCOUNTS_ID, "Management accounts, May 2025 to Oct 2026", "Financials"],
    [KPI_ID, "KPI and product metrics pack", "Fundraising summary"],
    [PLAN_ID, "Team and hiring plan", "Team"],
  ].map(([documentId, title, folder]) => ({
    documentId,
    title,
    folder,
    status: "shared with you",
  })),
  openRequests: 0,
};

/** The KPI pack's page as the shared read returned it (full of 4s). */
const KPI_PAGE =
  "KPI and product metrics pack\nNHS trusts, health boards and councils | 3 | 3 | 3 | 4 | 4 | 4\nLicensed seats | 16,800 | 17,900 | 19,400 | 21,600 | 22,700 | 24,000\nNet burn GBP 92,340; cash GBP 388,070; runway 4.2 months at this burn.";

const GATEQ_INBOX = {
  kind: "gateq",
  items: [
    {
      at: "2026-11-16T15:44:01.178Z",
      id: APPLICATION,
      facts: { fit: "FITS", stage: "Seed" },
      title: "Halyard Security",
      status: "read; none",
    },
  ],
  available: true,
};

const offered = (
  name: string,
  toolName: string,
  classification: QOfferedTool["classification"] = "READ_ONLY",
): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification,
  definition: {
    name,
    description: `${name}.`,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: null,
});

const TOOLS: readonly QOfferedTool[] = [
  offered("read_my", "app.own.read"),
  offered("gateq_inbox_summarise", "app.gateq.inbox.summarise"),
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

function toolsFor(): QToolPort & { readonly executed: QToolProposal[] } {
  const executed: QToolProposal[] = [];
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "read_my":
        return args["kind"] === "gateq" ? GATEQ_INBOX : null;
      case "gateq_inbox_summarise":
        return null;
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
          shortDescription:
            "Passkey rollout and phishing-resistant sign-in for NHS trusts and UK councils.",
          relationToYou: "SHARED",
        };
      case "read_company_figures":
        return { companyId: HALYARD, status: "AVAILABLE", figures: [] };
      case "get_relationship":
        return {
          yourSide: "INVESTOR",
          counterpart: {
            kind: "COMPANY",
            id: HALYARD,
            name: "Halyard Security",
          },
          relationship: {
            state: "IN_DILIGENCE",
            stateSince: "2026-11-16T15:00:00.000Z",
            milestones: [],
            nextStep: "NONE",
          },
          truthClass: "VERIFIED",
          source: "Capital Q relationship history",
        };
      case "read_company_data_room":
        return ROOM;
      case "read_document_pages":
        return {
          status: "READ",
          documentId: args["documentId"],
          title: "KPI and product metrics pack",
          folder: "Fundraising summary",
          pageCount: 1,
          pages: [{ page: 1, text: KPI_PAGE }],
          truncated: false,
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        };
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
    executed,
    offer: () => Promise.resolve(TOOLS),
    available: () => Promise.resolve(TOOLS),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve(outcomeOf(proposal, respond(proposal)));
    },
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
      purpose: {
        capability: "ANSWER",
        taskClass: "INVESTOR_QUESTION",
      },
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
  const started = Date.parse("2026-11-16T19:39:05.000Z");
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
  const tools = toolsFor();
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    // The plan's text reached the live answers as retrieved passages.
    context: {
      assemble: () =>
        Promise.resolve({
          facts: RETRIEVED,
          subjectDescription: "passages from the company's shared documents",
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
  } as unknown as QAnswerRequest;
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  return {
    outcome,
    said: completed.at(-1)?.message.text ?? "",
    executed: tools.executed,
  };
}

describe("live re-check on 927f25ddd: Halyard's hiring plan from retrieved passages (conversation e7e3c866)", () => {
  it("T1: the wrong count is not published; the plan's own count is, or the sentence goes", async () => {
    const { outcome, said } = await turn(
      [
        { role: "Q", content: GREETING },
        { role: "USER", content: Q1 },
      ],
      T1_LIVE,
    );
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).not.toContain("4 public-sector account managers");
    expect(said).toContain("3 public-sector account managers");
    expect(said).toContain("6 deployment engineers and 4 product engineers");
    expect(said).toContain("planning to hire 15 people");
  });

  it("T1: the GateQ application is not read for a question about the company's plan", async () => {
    const { executed } = await turn(
      [
        { role: "Q", content: GREETING },
        { role: "USER", content: Q1 },
      ],
      T1_LIVE,
    );
    expect(executed.map((call) => call.name)).not.toContain(
      "gateq_inbox_summarise",
    );
  });

  it("T2: Q's own earlier wrong reply does not ground the repeated count", async () => {
    const { said, executed } = await turn(
      [
        { role: "Q", content: GREETING },
        { role: "USER", content: Q1 },
        { role: "Q", content: T1_LIVE },
        { role: "USER", content: Q2 },
      ],
      T2_LIVE,
    );
    expect(said).not.toContain("4 public-sector account managers");
    expect(said).toContain("3 public-sector account managers");
    expect(said).toContain("6 deployment engineers and 4 product engineers");
    expect(executed.map((call) => call.name)).not.toContain(
      "gateq_inbox_summarise",
    );
  });
});

describe("the principles, by themselves", () => {
  const corpus = (...extra: string[]) =>
    claimCorpus([...PLAN_CHUNKS, ...extra], new Date("2026-11-16T19:39:00Z"));

  it("a count is bound to its row even when the source's lines are run together", () => {
    const joined = claimCorpus(
      [PLAN_CHUNKS.join(" ").replace(/\n+/gu, " ")],
      new Date("2026-11-16T19:39:00Z"),
    );
    const out = checkAnswer(
      "The plan adds 15 people in total: 4 public-sector account managers, 1 information security and assurance manager, 6 deployment engineers, 4 product engineers and 1 finance and operations manager.",
      joined,
    );
    expect(out.text).toContain("3 public-sector account managers");
    expect(out.text).not.toContain("4 public-sector account managers");
  });

  it("a total stated in the sentence before holds the parts listed after it", () => {
    const out = checkAnswer(T1_LIVE, corpus(Q1));
    expect(out.text).toContain("3 public-sector account managers");
    expect(out.text).toContain("planning to hire 15 people");
  });

  it("a role wrapped across two table lines is still that role's row", () => {
    const out = checkAnswer(
      "The plan adds 2 information security and assurance managers in Q1.",
      corpus(),
    );
    expect(out.text).not.toContain("2 information security");
  });

  it("the role and its count on adjacent lines (columns extracted one per line)", () => {
    const columns = claimCorpus(
      [
        "Role\nPeople\nPublic-sector account manager\n3\nDeployment engineer\n6",
      ],
      new Date("2026-11-16T19:39:00Z"),
    );
    expect(
      checkAnswer("They plan 4 public-sector account managers.", columns).text,
    ).not.toContain("4 public-sector");
    expect(
      checkAnswer("They plan 3 public-sector account managers.", columns).text,
    ).toContain("3 public-sector account managers");
  });

  it("without a total to agree with, a contradicted count drops the sentence; nothing is invented", () => {
    const out = checkAnswer(
      "Halyard plans 4 public-sector account managers in Q1.",
      corpus(),
    );
    expect(out.text).not.toContain("4 public-sector");
    expect(out.text).not.toContain("3 public-sector");
  });

  it("a count the row states is kept", () => {
    const said = "Halyard plans 3 public-sector account managers in Q1.";
    expect(checkAnswer(said, corpus()).text).toContain(said);
  });

  it("the GateQ application is read for a question about it, not for one about the plan", async () => {
    const calls: string[] = [];
    const execute = (name: string) => {
      calls.push(name);
      return Promise.resolve(name === "read_my" ? GATEQ_INBOX : null);
    };
    const available = new Set(["read_my", "gateq_inbox_summarise"]);
    await readNamedGateqApplications({
      side: "INVESTOR",
      available,
      latest: Q1,
      earlier: [],
      execute,
    });
    await readNamedGateqApplications({
      side: "INVESTOR",
      available,
      latest: Q2,
      earlier: [Q1],
      execute,
    });
    expect(calls).not.toContain("gateq_inbox_summarise");
    await readNamedGateqApplications({
      side: "INVESTOR",
      available,
      latest:
        "What did Halyard Security say in their application about hiring?",
      earlier: [],
      execute,
    });
    expect(calls).toContain("gateq_inbox_summarise");
  });
});
