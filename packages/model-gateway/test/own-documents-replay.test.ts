import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

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
  ownDocumentReads,
  ownEvidenceTurn,
  uploadedDocumentsOf,
} from "../src/q/own-documents.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 16 Nov 2026 (production b156a9cd1, Halyard Security's seeded
 * founder, conversation d3d81729; fictional data from
 * scripts/seed/evidence/fixtures/halyard.json). ADR 0079 let the founder's
 * own Q read their highly confidential documents, but none was read unless
 * named:
 *   278141d8 (ADVICE) "what's most worth fixing before the raise?" -> asked
 *     for a cap table and a cash bridge already uploaded.
 *   5f75f14f (THEIR_OWN_RECORDS) "which of our figures do our documents
 *     back up?" -> "no separate financial record corroborates" the deck's
 *     cash, burn and runway; asked for invoices and bank statements.
 *   d178c978 (THEIR_OWN_RECORDS) "does anything contradict our deck?" ->
 *     no document read.
 * Replayed with a fake model; the tools authorise as the person, as the
 * production tools do (list_uploaded_documents lists their own company's
 * uploads only; read_document_pages re-checks the membership).
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const HALYARD = "4a1e0000-0000-4000-8000-0000000000a1";
const OTHER_COMPANY = "4a1e0000-0000-4000-8000-0000000000b2";

const DOC = {
  accounts: "7d1605cc-0000-4000-8000-000000000001",
  accountsOld: "7d1605cc-0000-4000-8000-000000000002",
  invoices: "5ce41404-0000-4000-8000-000000000003",
  capTable: "c0000000-0000-4000-8000-000000000004",
  bank: "b0000000-0000-4000-8000-000000000005",
  kpi: "k0000000-0000-4000-8000-000000000006".replace("k", "a"),
  deck: "d0000000-0000-4000-8000-000000000007",
  passport: "e0000000-0000-4000-8000-000000000008",
} as const;

const ACCOUNTS_TITLE = "Management accounts, Nov 2025 to Oct 2026";
const INVOICES_TITLE = "Invoice register, Nov 2025 to Oct 2026";
const CAP_TABLE_TITLE = "Capitalisation table at 31 Oct 2026";
const BANK_TITLE = "Business account statement, Aug 2026 to Oct 2026";
const PASSPORT_TITLE = "Founder identity document";

const HELD =
  "Held back from Q by its classification (restricted, e.g. an identity document): Q does not read its contents and never sends them to a model.";

/** list_uploaded_documents' output for Halyard's founder. */
const HALYARD_UPLOADS = {
  items: [
    [
      DOC.accountsOld,
      "Management accounts, Sep 2026",
      "MANAGEMENT_ACCOUNTS",
      "2026-10-10",
    ],
    [DOC.accounts, ACCOUNTS_TITLE, "MANAGEMENT_ACCOUNTS", "2026-11-12"],
    [
      DOC.deck,
      "Halyard Security seed deck (Oct 2026)",
      "PITCH_DECK",
      "2026-11-01",
    ],
    [DOC.invoices, INVOICES_TITLE, "FINANCIAL", "2026-11-12"],
    [DOC.capTable, CAP_TABLE_TITLE, "CORPORATE", "2026-11-12"],
    [DOC.bank, BANK_TITLE, "FINANCIAL", "2026-11-12"],
    [DOC.kpi, "KPI pack, Oct 2026", "OPERATIONAL", "2026-11-12"],
    [DOC.passport, PASSPORT_TITLE, "CORPORATE", "2026-11-12"],
  ].map(([documentId, title, documentType, updatedAt]) => ({
    documentId,
    title,
    documentType,
    status: "ACTIVE",
    processing: "READY",
    updatedAt: `${updatedAt ?? ""}T00:00:00.000Z`,
    ...(documentId === DOC.passport ? { qUse: HELD } : {}),
  })),
};

const OWN_READ = {
  companyId: HALYARD,
  membershipId: "00000000-0000-4000-8000-0000000000d1",
  say: "This is their own company's highly confidential material, read for them because they are a member of the company.",
};

const ACCOUNTS_PAGE_1 = [
  ACCOUNTS_TITLE,
  "Halyard Security Ltd | Period: Nov 2025 to Oct 2026 | Unaudited",
  "Summary for October 2026",
  "Revenue | 73,000",
  "Gross margin, 12 months to October 2026 | 29.3%",
  "Licence gross margin | 82.0%",
  "Net burn | 92,340",
  "Cash at month end | 388,070",
  "Runway at October net burn (months) | 4.2",
  "October adds two deployment engineers (headcount 21 to 23) and a recruitment fee (4,500).",
  "Cost of sales includes the deployment team's payroll.",
].join("\n");

const INVOICES_PAGE_1 = [
  INVOICES_TITLE,
  "October 2026 invoiced | 73,000",
  "September 2026 invoiced | 85,000",
  "October 2026 receipts | 71,000",
].join("\n");

function pagesRead(documentId: string) {
  const page =
    documentId === DOC.accounts
      ? { title: ACCOUNTS_TITLE, text: ACCOUNTS_PAGE_1 }
      : documentId === DOC.invoices
        ? { title: INVOICES_TITLE, text: INVOICES_PAGE_1 }
        : documentId === DOC.capTable
          ? { title: CAP_TABLE_TITLE, text: "Founders 72.4% | ESOP 10%" }
          : null;
  if (page === null) return null;
  return {
    status: "READ",
    documentId,
    title: page.title,
    folder: "Financials",
    pageCount: 3,
    pages: [{ page: 1, text: page.text }],
    truncated: false,
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    ownCompanyRead: OWN_READ,
  };
}

const DECK = {
  viewer: "OWNER",
  deck: null,
  confirmedByFounder: true,
  truthClass: "USER_CLAIM",
  sections: [
    {
      section: "FINANCIALS",
      status: "PRESENT",
      facts: [
        ["Gross margin", "82%", "2026"],
        ["Net burn", "About 70,000 a month", "September 30, 2026"],
        ["Cash", "480,000", "September 30, 2026"],
        ["Runway", "6.9 months", "September 30, 2026"],
      ].map(([label, value, asOf]) => ({
        label,
        value,
        asOf,
        pages: [11],
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      })),
    },
  ],
};

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
  offered("list_uploaded_documents", "documents.uploaded.list"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
  offered("read_company_deck", "company.deck.read"),
  offered("read_company_figures", "company.figures.read"),
  offered("read_my_record", "records.own.read"),
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

/**
 * The tools as the person: `member` is the company they hold a current
 * membership of (null: none). Only that company's uploads are listed, and
 * a page read is re-checked against it; RESTRICTED is never read.
 */
function toolsFor(member: string | null): QToolPort & {
  readonly executed: QToolProposal[];
} {
  const executed: QToolProposal[] = [];
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "list_uploaded_documents":
        return member === HALYARD
          ? HALYARD_UPLOADS
          : member === null
            ? null
            : { items: [] };
      case "read_document_pages": {
        const id =
          typeof args["documentId"] === "string" ? args["documentId"] : "";
        const company = args["companyId"];
        if (
          member !== HALYARD ||
          (company !== undefined && company !== HALYARD)
        )
          return null;
        if (id === DOC.passport) {
          return {
            status: "HELD_BACK",
            candidates: [],
            say: "Held back from Q by its classification.",
          };
        }
        return pagesRead(id);
      }
      case "read_company_deck":
        return args["companyId"] === member && member === HALYARD ? DECK : null;
      case "read_company_figures":
        return { companyId: HALYARD, status: "AVAILABLE", figures: [] };
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

function plan(side: "FOUNDER" | "INVESTOR"): PermittedContextPlan {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: {
      capability: "ANSWER",
      taskClass:
        side === "FOUNDER"
          ? "OWN_COMPANY_QUESTION"
          : "COUNTERPARTY_COMPANY_QUESTION",
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
  });
}

async function turn(options: {
  readonly said: string;
  readonly questionKind: string;
  readonly answer: string;
  readonly side?: "FOUNDER" | "INVESTOR";
  /** The company they hold a current membership of (null: none). */
  readonly member?: string | null;
}) {
  const side = options.side ?? "FOUNDER";
  const member = options.member === undefined ? HALYARD : options.member;
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      { kind: "TEXT", text: JSON.stringify(analyst(options.answer)) },
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
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: options.said,
      contentType: "TEXT",
      createdAt: "2026-11-16T15:04:00.000Z",
    } as unknown as QConversationMessage,
  ];
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
  const tools = toolsFor(member);
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    ...(side === "FOUNDER" && member !== null
      ? {
          ownCompanySnapshot: () =>
            Promise.resolve({
              companyId: member,
              name: member === HALYARD ? "Halyard Security" : "Other Co",
              shortDescription: null,
              stageCode: "seed",
              countryCode: "GB",
            }),
        }
      : {}),
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
    askerSide: side,
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(side),
    turnKind: "QUESTION_TO_Q",
    questionKind: options.questionKind,
    research: Promise.resolve({ mode: "NEVER", announceSourceChange: false }),
  } as unknown as QAnswerRequest;
  const outcome = await seam.answer(request);
  const sent = fake.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");
  const said = completed.at(-1)?.message.text ?? "";
  return { outcome, sent, said, executed: tools.executed };
}

const pageReads = (executed: readonly QToolProposal[]) =>
  executed
    .filter((call) => call.name === "read_document_pages")
    .map((call) => call.arguments as Record<string, unknown>);
const readIds = (executed: readonly QToolProposal[]) =>
  pageReads(executed).map((args) => args["documentId"]);

const FIX = "What's most worth fixing before the raise? Keep it short.";
const BACK_UP =
  "Which of the figures we're claiming do our own documents actually back up?";
const CONTRADICT =
  "Does anything in our own documents contradict what the deck says? Margin, burn, runway.";
const FOUNDER_ANSWER =
  "Your management accounts (Nov 2025 to Oct 2026) show net burn of 92,340 in October and cash of 388,070, 4.2 months of runway (p. 1); gross margin is 29.3% against the deck's 82% licence margin (p. 1).";

describe("live 16 Nov 2026 (Halyard on b156a9cd1): a founder's own evidence question reads their own uploaded documents", () => {
  for (const [label, said, questionKind] of [
    ["278141d8 what's most worth fixing", FIX, "ADVICE"],
    [
      "5f75f14f which figures our documents back up",
      BACK_UP,
      "THEIR_OWN_RECORDS",
    ],
    [
      "d178c978 does anything contradict our deck",
      CONTRADICT,
      "THEIR_OWN_RECORDS",
    ],
  ] as const) {
    it(`${label}: lists the uploads and pre-reads the latest management accounts, bounded`, async () => {
      const {
        sent,
        said: answered,
        executed,
      } = await turn({
        said,
        questionKind,
        answer: FOUNDER_ANSWER,
      });
      // Listed as the person, then the management accounts read.
      expect(executed.map((call) => call.name)).toContain(
        "list_uploaded_documents",
      );
      const reads = pageReads(executed);
      expect(reads[0]).toEqual({
        companyId: HALYARD,
        documentId: DOC.accounts,
        fromPage: 1,
        toPage: 3,
      });
      // The older accounts, the deck and the identity document are not read.
      expect(readIds(executed)).not.toContain(DOC.accountsOld);
      expect(readIds(executed)).not.toContain(DOC.deck);
      expect(readIds(executed)).not.toContain(DOC.passport);
      expect(reads.length).toBeLessThanOrEqual(2);
      // Burn, runway and gross margin reach the answer with page cites,
      // under the membership the read was made under.
      expect(sent).toContain("[p. 1]");
      expect(sent).toContain("Net burn | 92,340");
      expect(sent).toContain("Runway at October net burn (months) | 4.2");
      expect(sent).toContain("Gross margin, 12 months to October 2026 | 29.3%");
      expect(sent).toContain("uploaded by their own company");
      expect(sent).toContain("read for them because they are a member");
      // The uploads are named, and never asked for again.
      expect(sent).toContain("DOCUMENTS THEY HAVE UPLOADED");
      expect(sent).toContain(CAP_TABLE_TITLE);
      expect(sent).toContain(BANK_TITLE);
      expect(sent).toContain(
        "Never ask them to upload, provide or send a document listed here",
      );
      // The deck beside the accounts, both periods, the document's notes.
      expect(sent).toContain(
        "SIDE BY SIDE (code placed them; neither is wrong)",
      );
      expect(sent).toContain(
        "Net burn: About 70,000 a month (as of September 30, 2026), slide 11",
      );
      expect(sent).toContain('\\"Summary for October 2026\\" (p. 1)');
      expect(sent).toContain("October adds two deployment engineers");
      expect(answered).toContain("92,340");
    });
  }

  it("5f75f14f: the 'back up' turn also reads the invoice register", async () => {
    const { sent, executed } = await turn({
      said: BACK_UP,
      questionKind: "THEIR_OWN_RECORDS",
      answer: FOUNDER_ANSWER,
    });
    expect(readIds(executed)).toEqual([DOC.accounts, DOC.invoices]);
    expect(sent).toContain("October 2026 invoiced | 73,000");
  });

  it("an ownership question reads the cap table in the second slot", async () => {
    const { executed } = await turn({
      said: "Is our cap table ready for the raise, and who owns what?",
      questionKind: "THEIR_OWN_RECORDS",
      answer: "Founders hold 72.4% (p. 1).",
    });
    expect(readIds(executed)).toEqual([DOC.accounts, DOC.capTable]);
  });

  it("RESTRICTED stays held: named as held back, never read", async () => {
    const { sent, executed } = await turn({
      said: BACK_UP,
      questionKind: "THEIR_OWN_RECORDS",
      answer: FOUNDER_ANSWER,
    });
    expect(readIds(executed)).not.toContain(DOC.passport);
    expect(sent).toContain(
      `held back from Q by classification (restricted; never read, no model receives them): \\"${PASSPORT_TITLE}\\"`,
    );
  });

  it("a member of another company gets nothing of Halyard's", async () => {
    const { sent, executed } = await turn({
      said: BACK_UP,
      questionKind: "THEIR_OWN_RECORDS",
      answer: "Nothing uploaded yet.",
      member: OTHER_COMPANY,
    });
    expect(readIds(executed)).toEqual([]);
    expect(sent).not.toContain(ACCOUNTS_TITLE);
    expect(sent).not.toContain("92,340");
    expect(sent).not.toContain("DOCUMENTS THEY HAVE UPLOADED");
  });

  it("no current membership: the listing is refused and nothing is read", async () => {
    const { sent, executed } = await turn({
      said: CONTRADICT,
      questionKind: "THEIR_OWN_RECORDS",
      answer: "I can't see your documents.",
      member: null,
    });
    expect(readIds(executed)).toEqual([]);
    expect(sent).not.toContain("92,340");
  });

  it("an investor's turn does not take this path", async () => {
    const { executed } = await turn({
      said: BACK_UP,
      questionKind: "THEIR_OWN_RECORDS",
      answer: "Your mandate is on record.",
      side: "INVESTOR",
    });
    expect(executed.map((call) => call.name)).not.toContain(
      "list_uploaded_documents",
    );
    expect(readIds(executed)).toEqual([]);
  });
});

describe("own-documents: which turns and which documents", () => {
  const base = {
    side: "FOUNDER" as const,
    turnKind: "QUESTION_TO_Q",
    aboutSomeoneElse: false,
  };
  it("takes the reader's question kind and execution class, not words", () => {
    expect(
      ownEvidenceTurn({ ...base, questionKind: "THEIR_OWN_RECORDS" }),
    ).toBe(true);
    expect(ownEvidenceTurn({ ...base, questionKind: "ADVICE" })).toBe(true);
    expect(ownEvidenceTurn({ ...base, questionKind: "FIT" })).toBe(false);
    expect(ownEvidenceTurn({ ...base, questionKind: undefined })).toBe(false);
    expect(
      ownEvidenceTurn({
        ...base,
        questionKind: "ADVICE",
        executionClass: "CONVERSATIONAL_ACK",
      }),
    ).toBe(false);
    expect(
      ownEvidenceTurn({
        ...base,
        questionKind: "ADVICE",
        writingDocument: true,
      }),
    ).toBe(false);
    expect(
      ownEvidenceTurn({
        ...base,
        questionKind: "ADVICE",
        aboutSomeoneElse: true,
      }),
    ).toBe(false);
    expect(
      ownEvidenceTurn({ ...base, side: "INVESTOR", questionKind: "ADVICE" }),
    ).toBe(false);
  });

  it("never picks a deck or a held-back document", () => {
    const documents = uploadedDocumentsOf(HALYARD_UPLOADS) ?? [];
    expect(
      documents.find((one) => one.documentId === DOC.passport)?.heldBack,
    ).toBe(true);
    const chosen = ownDocumentReads({
      documents,
      question: "anything",
      max: 9,
    });
    const ids = chosen.map((one) => one.documentId);
    expect(ids[0]).toBe(DOC.accounts);
    expect(ids).not.toContain(DOC.deck);
    expect(ids).not.toContain(DOC.passport);
    expect(ids).not.toContain(DOC.accountsOld);
  });
});
