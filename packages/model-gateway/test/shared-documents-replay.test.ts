import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { CompanyAnalystResult } from "@capital-q/q-core";
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
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  asksForFigures,
  documentDeckDifferenceFact,
  listedDocumentsOf,
  sharedDocumentFor,
  sharedDocumentReads,
  sharedDocumentsFact,
  sharedPageRange,
} from "../src/q/shared-documents.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 16 Nov 2026 (production 4f43012a6): investor Savanna Seed Partners
 * (fictional), Tensorgate IN_DILIGENCE, eight documents shared through
 * founder grants (management accounts, revenue breakdown and projections
 * HIGHLY_CONFIDENTIAL, Q-readable for Savanna under ADR 0078), the deck in
 * the data room. Four turns:
 *   T1 "What's Tensorgate's burn and runway right now?" -> "aren't
 *      recorded": no document listed or read; the deck read (burn $135k,
 *      runway 8.1 months on its FINANCIALS slide) discarded because the
 *      own-records read had taken Tensorgate for its profile only.
 *   T2 "Does that match what their deck says?" -> "the deck does not
 *      establish burn" (no deck read on a follow-up).
 *   T3 "Which documents is that based on?" -> profile and deck only.
 *   T4 "What would resolve the remaining question on Tensorgate?" -> asked
 *      for the management accounts already shared, and closed with "The
 *      public web search was unavailable this turn".
 * Replayed in that shape with a fake model and fixture data
 * (scripts/seed/evidence/fixtures/tensorgate.json knownDiscrepancies
 * tg-burn-runway: deck Sep 2026 $135k / 8.1 months; accounts Oct 2026
 * 152,800 / 6.2 months). No provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const SAVANNA = "0f000000-0000-4000-8000-0000000000f1";
const TENSORGATE = "bf55d6e1-567a-4b5e-9b83-054ae05990e2";

const DOC = {
  accounts: "dc002308-9fe7-4690-975a-cf354b1a2e90",
  revenue: "303c040f-2f70-432e-b235-a0741d1c8da0",
  contracts: "517dceab-cebb-4914-ba10-09f49a6ce515",
  concentration: "24e169dd-7af3-4758-a2de-71f1d762905d",
  capTable: "1260f55b-8f38-4652-b1e8-965ed94de7e4",
  terms: "a41cba4d-9971-4cfa-8cba-c8a98a1cc70f",
  projections: "a7b8eab7-785f-4d4c-8e9d-f0658e23186c",
  kpi: "31dd8098-89c7-43a9-80a1-1360898396c8",
  deck: "c975d2d2-21ee-4fd8-a6eb-e64bdd660fd0",
  // Founder-private: no grant, no data-room entry.
  bank: "8fba21b9-be72-46d9-993e-0cd9131927cf",
} as const;

const ACCOUNTS_TITLE = "Management accounts, May 2025 to Oct 2026";
const BANK_TITLE =
  "Business account statement, Aug 2026 to Oct 2026, with monthly balances";

/** read_company_data_room's output for Savanna: the eight shares and the deck. */
const SAVANNA_ROOM = {
  viewer: "INVESTOR",
  documents: [
    [DOC.accounts, ACCOUNTS_TITLE, "Financials"],
    [DOC.revenue, "Monthly revenue by customer", "Financials"],
    [DOC.contracts, "Customer contract summary", "Commercial"],
    [DOC.concentration, "Customer concentration", "Commercial"],
    [DOC.capTable, "Capitalisation table and ownership", "Corporate"],
    [DOC.terms, "Seed round terms and use of funds", "Corporate"],
    [
      DOC.projections,
      "Projections to December 2027, with assumptions",
      "Financials",
    ],
    [DOC.kpi, "KPI and product metrics pack", "Operations"],
  ]
    .map(([documentId, title, folder]) => ({
      documentId,
      title,
      folder,
      status: "shared with you",
    }))
    .concat([
      {
        documentId: DOC.deck,
        title: "Tensorgate seed deck (Oct 2026)",
        folder: "Fundraising",
        status: "open to you",
      },
    ]),
  openRequests: 0,
};

/** Another connected investor: no grant; the deck only, as the room shows it. */
const OTHER_ROOM = {
  viewer: "INVESTOR",
  documents: [
    {
      documentId: DOC.deck,
      title: "Tensorgate seed deck (Oct 2026)",
      folder: "Fundraising",
      status: "open to you",
    },
    {
      documentId: DOC.accounts,
      title: ACCOUNTS_TITLE,
      folder: "Financials",
      status: "on request",
    },
  ],
  openRequests: 0,
};

const ACCOUNTS_PAGE_1 = [
  "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD",
  ACCOUNTS_TITLE,
  "Tensorgate, Inc. | Period: May 2025 to Oct 2026 | Version 1.0 | Issued 12 Nov 2026",
  "Summary for October 2026",
  "Revenue | 30,000",
  "Net result for the month | -152,800",
  "Cash at month end | 948,840",
  "Net burn (payments less customer receipts) | 152,800",
  "Runway at this month's net burn (months) | 6.2",
  "October adds the SOC 2 Type I audit fee (18,500) and seed-round legal fees (9,000).",
].join("\n");

const pagesRead = (documentId: string) =>
  documentId === DOC.accounts
    ? {
        status: "READ",
        documentId,
        title: ACCOUNTS_TITLE,
        folder: "Financials",
        pageCount: 3,
        pages: [{ page: 1, text: ACCOUNTS_PAGE_1 }],
        truncated: false,
        truthClass: "USER_CLAIM",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        sharedUnder: {
          grantId: "grant-accounts",
          expiresAt: "2027-02-14T00:00:00.000Z",
          say: "The founder shared this document with their organisation, so Q may read it for them.",
        },
      }
    : documentId === DOC.kpi
      ? {
          status: "READ",
          documentId,
          title: "KPI and product metrics pack",
          folder: "Operations",
          pageCount: 1,
          pages: [
            {
              page: 1,
              text: "Net burn, Oct 2026: 152,800. Requests served: 31 million.",
            },
          ],
          truncated: false,
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }
      : null;

const DECK = {
  viewer: "INVESTOR",
  deck: null,
  confirmedByFounder: true,
  truthClass: "USER_CLAIM",
  sections: [
    {
      section: "TRACTION",
      status: "PRESENT",
      facts: [
        {
          label: "Paid contracts",
          value: "2",
          asOf: "September 2026",
          pages: [7],
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
    {
      section: "FINANCIALS",
      status: "PRESENT",
      facts: [
        ["Cash", "$1.1m", "September 30, 2026"],
        ["Current monthly net burn", "About $135k", "2026"],
        ["Runway at current burn", "8.1 months", "2026"],
      ].map(([label, value, asOf]) => ({
        label,
        value,
        asOf,
        pages: [10],
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      })),
    },
  ],
};

const RELATIONSHIP = {
  yourSide: "INVESTOR",
  counterpart: { kind: "COMPANY", id: TENSORGATE, name: "Tensorgate" },
  relationship: {
    state: "IN_DILIGENCE",
    stateSince: "2026-11-16T06:30:00.000Z",
    milestones: [
      { state: "INTEREST_EXPRESSED", at: "2026-11-16T06:28:00.000Z" },
      { state: "CONNECTED", at: "2026-11-16T06:29:00.000Z" },
      { state: "IN_DILIGENCE", at: "2026-11-16T06:30:00.000Z" },
    ],
    nextStep: "NONE",
  },
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
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
  offered("list_my_relationships", "relationship.own.list"),
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("read_company_deck", "company.deck.read"),
  offered("get_relationship", "relationship.get"),
  offered("read_company_data_room", "company.data_room.read"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
  offered("research_public_web", "public_web.search"),
  // Their day (production offers these to an investor on every turn).
  offered("list_schedule", "schedule.list"),
  offered("list_pending_approvals", "approvals.pending.list"),
  offered("list_q_work", "q.work.list"),
  offered("diligence_documents", "app.diligence.request", "SIDE_EFFECT"),
];

function outcomeOf(proposal: QToolProposal, data: unknown): QToolCallOutcome {
  const tool = TOOLS.find((one) => one.definition.name === proposal.name);
  if (data === null) {
    return {
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
    };
  }
  return {
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

/** A traced step of a timed turn, in virtual milliseconds from its start. */
type Traced = { readonly what: string; readonly ms: number };

/** The data room authorises as the person: Savanna sees its grants only. */
function toolsFor(
  room: unknown,
  timing?: {
    readonly latencyMs: (proposal: QToolProposal) => number;
    readonly trace: (what: string) => void;
  },
): QToolPort & {
  readonly executed: QToolProposal[];
} {
  const executed: QToolProposal[] = [];
  const shared = new Set(
    (listedDocumentsOf(room) ?? [])
      .filter((document) => document.access !== "REQUESTED")
      .map((document) => document.documentId),
  );
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "list_my_relationships":
        return {
          relationships: [
            {
              relationshipId: "5e000000-0000-4000-8000-000000000001",
              counterpart: {
                kind: "COMPANY",
                id: TENSORGATE,
                name: "Tensorgate",
              },
              state: "IN_DILIGENCE",
              stateSince: "2026-11-16T06:30:00.000Z",
              nextStep: "NONE",
              messagesRead: "OK",
              lastMessage: null,
            },
          ],
        };
      case "search_companies":
        return {
          items: [{ companyId: TENSORGATE, canonicalName: "Tensorgate" }],
          nextCursor: null,
        };
      case "get_company":
        return {
          companyId: TENSORGATE,
          canonicalName: "Tensorgate",
          currentStageCode: "seed",
          shortDescription:
            "A gateway that runs LLM inference inside hardware enclaves.",
          relationToYou: "SHARED",
        };
      case "read_company_figures":
        return {
          companyId: TENSORGATE,
          status: "AVAILABLE",
          figures: [
            {
              key: "traction.paid_contracts",
              statement: "Tensorgate: Paid contracts: 2 in September 2026.",
              value: null,
              asOf: "2026-09-30",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
          ],
        };
      case "read_company_deck":
        return DECK;
      case "get_relationship":
        return RELATIONSHIP;
      case "read_company_data_room":
        return room;
      case "read_document_pages": {
        const asked = args["documentId"];
        const id = typeof asked === "string" ? asked : "";
        return shared.has(id) ? pagesRead(id) : null;
      }
      case "list_schedule":
        return { items: [] };
      case "list_pending_approvals":
        return { approvals: [] };
      case "list_q_work":
        return { work: [] };
      case "research_public_web":
        return {
          status: "PROVIDER_UNAVAILABLE",
          sources: [],
          say: "Public web search is unavailable right now.",
        };
      default:
        return null;
    }
  };
  return {
    executed,
    offer: () => Promise.resolve(TOOLS),
    available: () => Promise.resolve(TOOLS),
    execute: async (proposal) => {
      executed.push(proposal);
      if (timing !== undefined) {
        timing.trace(`start ${proposal.name}`);
        await new Promise((resolve) =>
          setTimeout(resolve, timing.latencyMs(proposal)),
        );
        timing.trace(`end ${proposal.name}`);
      }
      return outcomeOf(proposal, respond(proposal));
    },
  };
}

function analyst(
  answer: string,
  extra: Partial<Record<string, unknown>> = {},
): CompanyAnalystResult {
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
    ...extra,
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
        taskClass: "COUNTERPARTY_COMPANY_QUESTION",
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
          investorOrganisationId: SAVANNA,
        },
      },
    ],
  } as unknown as PermittedContextPlan;
}

type Turn = { readonly role: "USER" | "Q"; readonly content: string };

async function turn(options: {
  readonly earlier: readonly Turn[];
  readonly said: string;
  readonly script: readonly FakeBehaviour[];
  readonly room?: unknown;
  readonly questionKind?: string;
  readonly research?: "EXPLICIT" | "NEVER";
  /** Production-shaped latencies on the virtual clock (timing replay). */
  readonly timing?: {
    readonly latencyMs: (proposal: QToolProposal) => number;
    readonly modelMs: number;
  };
}) {
  const traced: Traced[] = [];
  const clockStart = Date.now();
  const trace = (what: string): void => {
    traced.push({ what, ms: Date.now() - clockStart });
  };
  const fake = createFakeModelProvider({
    code: "alpha",
    script: options.script,
  });
  const timing = options.timing;
  const alpha: typeof fake =
    timing === undefined
      ? fake
      : {
          ...fake,
          generate: async (request, context) => {
            trace("model asked");
            await new Promise((resolve) => setTimeout(resolve, timing.modelMs));
            trace("model answered");
            return fake.generate(request, context);
          },
        };
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(
      testCatalog((s) => ({
        ...s,
        models: s.models.map((m) => ({ ...m, supportsTools: true })),
      })),
    ),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const started = Date.parse("2026-11-16T08:59:00.000Z");
  const messages: QConversationMessage[] = [
    ...options.earlier,
    { role: "USER" as const, content: options.said },
  ].map(
    (message, index) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: CONVERSATION,
        runId: RUN,
        role: message.role,
        content: message.content,
        contentType: "TEXT",
        createdAt: new Date(started + index * 1_000).toISOString(),
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
  const tools = toolsFor(
    options.room ?? SAVANNA_ROOM,
    timing === undefined ? undefined : { latencyMs: timing.latencyMs, trace },
  );
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
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
    questionKind: options.questionKind ?? "THEIR_OWN_RECORDS",
    aboutNamedOther: true,
    namedOther: { kind: "COMPANY", name: "Tensorgate" },
    research: Promise.resolve({
      mode: options.research ?? "EXPLICIT",
      announceSourceChange: false,
    }),
  } as unknown as QAnswerRequest;
  const outcome = await seam.answer(request);
  const sent = alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");
  const said = completed.at(-1)?.message.text ?? "";
  return { outcome, sent, said, executed: tools.executed, traced };
}

const ANSWER = (text: string): FakeBehaviour => ({
  kind: "TEXT",
  text: JSON.stringify(analyst(text)),
});

const T1 = "What's Tensorgate's burn and runway right now?";
const T1_ANSWER =
  "Tensorgate's management accounts (May 2025 to Oct 2026) show net burn of 152,800 in October 2026 and cash of 948,840, about 6.2 months of runway.";
const T2 = "Does that match what their deck says?";
const T2_ANSWER =
  "Not exactly: Tensorgate's deck gives about $135k a month and 8.1 months at 30 September; October's accounts are higher.";
const T3 = "Which documents is that based on?";
const T4 = "What would resolve the remaining question on Tensorgate?";

const readsOf = (executed: readonly QToolProposal[], name: string) =>
  executed
    .filter((call) => call.name === name)
    .map((call) => (call.arguments as Record<string, unknown>)["documentId"]);

describe("live 16 Nov 2026: an investor's figures question is answered from what the company shared with them", () => {
  it("T1: lists the shared documents, reads the management accounts, and the deck's burn reaches the answer", async () => {
    const { sent, executed } = await turn({
      earlier: [],
      said: T1,
      script: [ANSWER(T1_ANSWER)],
    });
    // One cheap listing, as the person, then the most evidential reads.
    expect(executed.map((call) => call.name)).toContain(
      "read_company_data_room",
    );
    expect(readsOf(executed, "read_document_pages")).toContain(DOC.accounts);
    // The accounts' October figures, with their period and title.
    expect(sent).toContain(
      "Net burn (payments less customer receipts) | 152,800",
    );
    expect(sent).toContain("Runway at this month's net burn (months) | 6.2");
    expect(sent).toContain(ACCOUNTS_TITLE);
    expect(sent).toContain("DOCUMENTS TENSORGATE HAS SHARED WITH THEM");
    // The deck's FINANCIALS were read and kept (no longer discarded).
    expect(sent).toContain("Current monthly net burn: About $135k");
    expect(sent).toContain("Runway at current burn: 8.1 months");
    // Founder-private: never listed, never read.
    expect(sent).not.toContain(BANK_TITLE);
    expect(readsOf(executed, "read_document_pages")).not.toContain(DOC.bank);
    // A deck's figures come from the deck read, not a page read here.
    expect(readsOf(executed, "read_document_pages")).not.toContain(DOC.deck);
  });

  it("T2: a follow-up about the deck carries the deck's figures and the accounts', to compare and explain", async () => {
    const { sent, executed } = await turn({
      earlier: [
        { role: "USER", content: T1 },
        { role: "Q", content: T1_ANSWER },
      ],
      said: T2,
      script: [ANSWER(T2_ANSWER)],
    });
    expect(sent).toContain("Current monthly net burn: About $135k");
    expect(sent).toContain("Runway at current burn: 8.1 months");
    expect(sent).toContain("152,800");
    // Live rerun on bab915357 (turn 2): "they conflict", with no reason,
    // though the accounts carry the period and its notes. Both periods and
    // the document's own notes reach the answer, with the instruction to
    // explain the difference from them (or say they do not explain it).
    expect(sent).toContain("SIDE BY SIDE (code placed them; neither is wrong)");
    expect(sent).toContain("Cash: $1.1m (as of September 30, 2026), slide 10");
    expect(sent).toContain('\\"Summary for October 2026\\" (p. 1)');
    expect(sent).toContain(
      'Its own notes on the pages read: \\"October adds the SOC 2 Type I audit fee (18,500) and seed-round legal fees (9,000).\\" (p. 1)',
    );
    expect(sent).toContain(
      "explain the difference only from the document's own notes and its line items for those periods; if those do not explain it, say the documents do not explain the difference. Never call either figure wrong, and never give a reason the documents do not state.",
    );
    expect(sent).toContain(
      "explain the difference from the document's own notes and line items for those periods, or say the documents do not explain it",
    );
    // Whether they agree is read from the accounts alone, over the pages
    // that carry both periods' lines, not the whole document.
    const pages = executed.filter(
      (call) => call.name === "read_document_pages",
    );
    expect(pages.map((call) => call.arguments)).toEqual([
      {
        companyId: TENSORGATE,
        documentId: DOC.accounts,
        fromPage: 1,
        toPage: 3,
      },
    ]);
  });

  it("T3: which documents -- the listing names them, by title and period", async () => {
    const { sent, executed } = await turn({
      earlier: [
        { role: "USER", content: T1 },
        { role: "Q", content: T1_ANSWER },
        { role: "USER", content: T2 },
        { role: "Q", content: T2_ANSWER },
      ],
      said: T3,
      script: [
        ANSWER(
          `Their management accounts ("${ACCOUNTS_TITLE}") and the seed deck (Oct 2026).`,
        ),
      ],
    });
    expect(executed.map((call) => call.name)).toContain(
      "read_company_data_room",
    );
    expect(sent).toContain(`${ACCOUNTS_TITLE}\\" (Financials)`);
    expect(sent).toContain('KPI and product metrics pack\\" (Operations)');
    expect(sent).toContain('Tensorgate seed deck (Oct 2026)\\" (Fundraising)');
    expect(sent).toContain("never offer to request any of them");
  });

  it("T4: no request for what is already shared, and no public-web disclosure nobody asked for", async () => {
    const UNCERTAIN =
      "Tensorgate's current monthly burn and runway after October 2026, given the deck's September figures.";
    const OFFER =
      "Want me to ask Tensorgate for their latest management accounts?";
    const { outcome, said } = await turn({
      earlier: [
        { role: "USER", content: T1 },
        { role: "Q", content: T1_ANSWER },
        { role: "USER", content: T2 },
        { role: "Q", content: T2_ANSWER },
        { role: "USER", content: T3 },
        {
          role: "Q",
          content: "Tensorgate: their management accounts and the seed deck.",
        },
      ],
      said: T4,
      questionKind: "ADVICE",
      script: [
        {
          kind: "TOOL_CALLS",
          calls: [
            {
              callId: "w",
              name: "research_public_web",
              arguments: { query: T4 },
            },
          ],
        },
        {
          kind: "TEXT",
          text: JSON.stringify(
            analyst(
              "The deck's September figures and October's accounts differ; the October accounts settle the current position.",
              {
                missingEvidence: ["Bank statements for Aug to Oct 2026"],
                uncertainties: [
                  {
                    statement: UNCERTAIN,
                    standing: "REPORTED",
                    material: true,
                    mattersFor: ["THESIS"],
                    resolveBy: ["REQUEST_DOCUMENT"],
                  },
                ],
                offer: {
                  said: OFFER,
                  action: "diligence_documents",
                  request:
                    "Ask Tensorgate for their latest management accounts.",
                  about: UNCERTAIN,
                },
              },
            ),
          ),
        },
      ],
    });
    expect(outcome.kind).toBe("ANSWERED");
    expect(outcome.kind === "ANSWERED" ? outcome.offer : null).toBeUndefined();
    expect(said).not.toContain(OFFER);
    expect(said).toContain(
      `has already shared "${ACCOUNTS_TITLE}" with you in their data room`,
    );
    expect(said).not.toMatch(/public web search was unavailable/iu);
  });

  it("negative: another investor without grants gets no shared listing and no read of the accounts", async () => {
    const { sent, executed } = await turn({
      earlier: [],
      said: T1,
      room: OTHER_ROOM,
      script: [ANSWER("Tensorgate's deck gives about $135k a month.")],
    });
    expect(readsOf(executed, "read_document_pages")).toEqual([]);
    expect(sent).not.toContain("DOCUMENTS TENSORGATE HAS SHARED WITH THEM");
    expect(sent).not.toContain("152,800");
    expect(sent).not.toContain(BANK_TITLE);
    // What is open to them in the room (the deck) is all that is named.
    expect(sent).toContain(
      "has not shared any document with them individually",
    );
  });

  it("negative: a locked room (not connected) lists and reads nothing", async () => {
    const { sent, executed } = await turn({
      earlier: [],
      said: T1,
      room: {
        viewer: "INVESTOR",
        openRequests: 0,
        locked: "Their data room opens once the founders accept your interest.",
      },
      script: [ANSWER("Not visible yet.")],
    });
    expect(readsOf(executed, "read_document_pages")).toEqual([]);
    expect(sent).not.toContain("SHARED WITH THEM");
  });
});

describe("shared-documents helpers", () => {
  const listed = listedDocumentsOf(SAVANNA_ROOM) ?? [];

  it("takes only the investor's open, shared and requested documents, with ids", () => {
    expect(listed).toHaveLength(9);
    expect(listedDocumentsOf({ ...SAVANNA_ROOM, viewer: "OWNER" })).toBeNull();
    expect(listedDocumentsOf(OTHER_ROOM)?.map((d) => d.access)).toEqual([
      "OPEN",
    ]);
  });

  it("reads the management accounts first, never the deck, whatever the words", () => {
    for (const question of [T1, "¿Cuál es su runway?", T3]) {
      const reads = sharedDocumentReads({
        documents: listed,
        question,
        alreadyRead: new Set(),
      });
      expect(reads[0]?.documentId).toBe(DOC.accounts);
      expect(reads.map((d) => d.documentId)).not.toContain(DOC.deck);
      expect(reads.length).toBeLessThanOrEqual(2);
    }
  });

  it("bounds a figures read to the summary page and a consistency read to the pages of both periods", () => {
    const T1_LIVE =
      "How much cash is Tensorgate burning each month, and how long will it last?";
    expect(asksForFigures(T1_LIVE)).toBe(true);
    expect(sharedPageRange({ question: T1_LIVE, reconcile: false })).toEqual({
      fromPage: 1,
      toPage: 1,
    });
    expect(
      sharedPageRange({
        question: "Is that consistent with their pitch deck?",
        reconcile: true,
      }),
    ).toEqual({ fromPage: 1, toPage: 3 });
    // Not a figures question: the document as before (the tool's bound).
    expect(sharedPageRange({ question: T3, reconcile: false })).toBeNull();
  });

  it("a document with no note of its own is said to carry none, and nothing is invented", () => {
    // The seeded accounts' page 1 (scripts/seed/evidence/documents.mjs):
    // the summary table and the basis of preparation, no movement note.
    const page = [
      "Management accounts, May 2025 to Oct 2026",
      "Basis of preparation",
      "Prepared by the company with its outsourced bookkeeper; unaudited. Accrual basis. Amounts in USD, whole units.",
      "Summary for October 2026",
      "Cash at month end 948,840",
      "Net burn (payments less customer receipts) 152,800",
    ].join("\n");
    const fact = documentDeckDifferenceFact({
      company: "Tensorgate",
      deck: DECK,
      document: { title: ACCOUNTS_TITLE, pages: [{ page: 1, text: page }] },
    });
    expect(fact?.statement).toContain('"Summary for October 2026" (p. 1)');
    expect(fact?.statement).toContain(
      "The pages read carry no note explaining a movement in these figures",
    );
    expect(fact?.statement).not.toMatch(/SOC 2|legal fees|GPU/u);
    expect(fact?.truthClass).toBe("USER_CLAIM");
    // No deck figures, or no page read: no side-by-side at all.
    expect(
      documentDeckDifferenceFact({
        company: "Tensorgate",
        deck: { sections: [] },
        document: { title: ACCOUNTS_TITLE, pages: [{ page: 1, text: page }] },
      }),
    ).toBeNull();
  });

  it("a figures item is answered by the shared accounts; a pending request is said as pending", () => {
    expect(
      sharedDocumentFor("current burn and runway", listed)?.documentId,
    ).toBe(DOC.accounts);
    expect(sharedDocumentFor("the founders' references", listed)).toBeNull();
    const fact = sharedDocumentsFact("Tensorgate", [
      ...listed,
      {
        documentId: DOC.bank,
        title: "Business bank statements, Aug to Oct 2026",
        folder: "Financials",
        access: "REQUESTED",
      },
    ]);
    expect(fact?.statement).toContain("pending, never ask again");
    expect(fact?.truthClass).toBe("VERIFIED");
  });
});

/**
 * Live rerun on bab915357 (16 Nov 2026, 11:45 UTC, conversation 3d510d8e):
 * turn 1 ("How much cash is Tensorgate burning each month, and how long
 * will it last?") was right but took 23.1 s with 21 tools. Replayed on a
 * virtual clock with production-shaped latencies (each an HTTPS hop from
 * q-api to the api and its database; the data-room listing and a page read
 * re-authorise the room, so they cost more):
 *   list_my_relationships   400 ms     read_company_data_room   600 ms
 *   get_company / figures   300 ms     read_document_pages      900 ms
 *   read_company_deck       500 ms     schedule / approvals /
 *   get_relationship        300 ms       Q work                 300 ms
 *   research_public_web   4,000 ms     answer model           1,000 ms
 * Target: the answer call starts within ~4 s of arrival; the data-room
 * listing and the page reads overlap the other reads instead of following
 * them; schedule, approvals, Q work and the public web never block it; and
 * the page reads ask only for the pages that carry the figures.
 */
const LATENCY: Readonly<Record<string, number>> = {
  list_my_relationships: 400,
  get_company: 300,
  read_company_figures: 300,
  read_company_deck: 500,
  get_relationship: 300,
  read_company_data_room: 600,
  read_document_pages: 900,
  list_schedule: 300,
  list_pending_approvals: 300,
  list_q_work: 300,
  search_companies: 300,
  research_public_web: 4_000,
};

/** Runs `work` on the virtual clock (as shown-list-explanation-timing.test.ts does). */
async function onVirtualClock<T>(work: () => Promise<T>): Promise<T> {
  let settled = false;
  const running = work().finally(() => {
    settled = true;
  });
  for (let step = 0; !settled && step < 200_000; step += 1) {
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersToNextTimerAsync();
    } else {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return running;
}

describe("live rerun bab915357: a figures question over shared documents is not slow", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "performance",
        "Date",
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const T1_LIVE =
    "How much cash is Tensorgate burning each month, and how long will it last?";

  it("T1: the answer call starts within ~4 s; data-room reads overlap; no day or web read blocks it", async () => {
    const { traced, executed, sent } = await onVirtualClock(() =>
      turn({
        earlier: [],
        said: T1_LIVE,
        script: [ANSWER(T1_ANSWER)],
        timing: {
          latencyMs: (proposal) => LATENCY[proposal.name] ?? 300,
          modelMs: 1_000,
        },
      }),
    );
    if (process.env["CQ_TIMING_DEBUG"] === "1") {
      console.log(traced.map((t) => `${String(t.ms)} ${t.what}`).join("\n"));
    }
    const at = (what: string): number =>
      traced.find((one) => one.what === what)?.ms ?? Number.POSITIVE_INFINITY;
    const asked = at("model asked");
    // Still right: the accounts read, the figures reach the answer.
    expect(sent).toContain(
      "Net burn (payments less customer receipts) | 152,800",
    );
    expect(asked).toBeLessThanOrEqual(4_000);
    // The listing starts beside the first reads, not after the named reads.
    expect(at("start read_company_data_room")).toBeLessThan(
      at("end read_company_deck"),
    );
    // Nothing the figures do not need finishes after the model was asked
    // and before it: no day read or web search holds the answer back.
    for (const name of [
      "list_schedule",
      "list_pending_approvals",
      "list_q_work",
    ]) {
      expect(at(`start ${name}`)).toBeGreaterThanOrEqual(asked);
    }
    // The web search begun with the turn (owner: in parallel) is not waited
    // on, and the answer is not asked again with it: one answer call.
    expect(asked).toBeLessThan(at("end research_public_web"));
    expect(traced.filter((one) => one.what === "model asked")).toHaveLength(1);
    // Page reads are bounded to the pages that carry the figures.
    const pageReads = executed.filter(
      (call) => call.name === "read_document_pages",
    );
    expect(pageReads.length).toBeGreaterThan(0);
    for (const call of pageReads) {
      const args = call.arguments as Record<string, unknown>;
      expect(args["fromPage"]).toBe(1);
      expect(typeof args["toPage"]).toBe("number");
    }
  });
});
