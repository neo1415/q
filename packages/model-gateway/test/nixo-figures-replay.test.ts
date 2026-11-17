import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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
import {
  companyFiguresLimitFact,
  withSharedDocumentsInLimits,
} from "../src/q/company-fact.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  furtherPageRange,
  measuresMissing,
  pagesCarrying,
} from "../src/q/shared-documents.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 17 Nov 2026, 10:07 UTC (production 4f542f5f6, run 9f10ec58):
 * investor Savanna Seed Partners (fictional) asked "What's Nixo's monthly
 * burn and runway?" Nixo (synthetic, decision 99) had shared its
 * management accounts with Savanna; code pre-read page 1 of them and of
 * "Monthly revenue by customer". Page 1 of the accounts states October
 * 2026 net burn 125,800 and runway 8.8 months, and the model's own finding
 * said so, yet the answer read "Nixo's monthly burn and runway aren't
 * established in what I can see": beside the page, code's figures-limit
 * fact said Q could read only Nixo's published figures (none) and its deck
 * (no figures), and that any figure not given there -- "burn, runway" --
 * was unknown to Q.
 *
 * The pages here are the stored read_document_pages text of that run and
 * of run 1f3d66f3 (pages 1-3). No provider, no network.
 */

type Page = { readonly page: number; readonly text: string };
type StoredDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly pageCount: number;
  readonly pages: readonly Page[];
};
const STORED = JSON.parse(
  readFileSync(new URL("./live-replays/nixo-17-nov.json", import.meta.url), {
    encoding: "utf8",
  }),
) as {
  readonly dataRoom: unknown;
  readonly managementAccounts: StoredDocument;
  readonly revenueByCustomer: StoredDocument;
};
const ACCOUNTS = STORED.managementAccounts;
const REVENUE = STORED.revenueByCustomer;

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const SAVANNA = "1c4b9266-350c-409d-9582-04a0f771b8a8";
const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

const LIVE = "What's Nixo's monthly burn and runway?";
const LIVE_ANSWER =
  "Nixo's management accounts (May 2025 to Oct 2026) show net burn of 125,800 in October 2026 and runway of 8.8 months at that burn.";
const LIMIT_BEFORE =
  "What Q could read of Nixo's figures for this person is its published figures on Capital Q and the figures its pitch deck states, given as facts here.";

/** read_document_pages as the tool reads it: the stored pages in range. */
function pagesRead(documentId: string, from: number, to: number): unknown {
  const document = [ACCOUNTS, REVENUE].find(
    (one) => one.documentId === documentId,
  );
  if (document === undefined) return null;
  return {
    status: "READ",
    documentId,
    title: document.title,
    folder: "Financials",
    pageCount: document.pageCount,
    pages: document.pages.filter((p) => p.page >= from && p.page <= to),
    truncated: false,
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    sharedUnder: {
      grantId: "grant",
      expiresAt: "2027-02-14T00:00:00.000Z",
      say: "The founder shared this document with their organisation, so Q may read it for them.",
    },
  };
}

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
  offered("list_my_relationships", "relationship.own.list"),
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("read_company_deck", "company.deck.read"),
  offered("get_relationship", "relationship.get"),
  offered("read_company_data_room", "company.data_room.read"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
  offered("list_schedule", "schedule.list"),
  offered("list_pending_approvals", "approvals.pending.list"),
  offered("list_q_work", "q.work.list"),
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

function tools(): QToolPort & { readonly executed: QToolProposal[] } {
  const executed: QToolProposal[] = [];
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "list_my_relationships":
        return { relationships: [] };
      case "search_companies":
        return {
          items: [{ companyId: NIXO, canonicalName: "Nixo" }],
          nextCursor: null,
        };
      case "get_company":
        return {
          companyId: NIXO,
          canonicalName: "Nixo",
          legalName: "Nixo Inc.",
          currentStageCode: "seed",
          shortDescription:
            "Helping AI companies achieve SaaS-level margins from custom deployments and services work.",
          relationToYou: "SHARED",
          truthClass: "USER_CLAIM",
        };
      // As live: no published figures; the deck read, with no sections.
      case "read_company_figures":
        return { companyId: NIXO, status: "NONE", figures: [] };
      case "read_company_deck":
        return {
          viewer: "INVESTOR",
          deck: { title: "Seed pitch deck", pageCount: 12 },
          sections: [],
          truthClass: "USER_CLAIM",
          confirmedByFounder: false,
        };
      case "get_relationship":
        return null;
      case "read_company_data_room":
        return STORED.dataRoom;
      case "read_document_pages": {
        const id =
          typeof args["documentId"] === "string" ? args["documentId"] : "";
        const from =
          typeof args["fromPage"] === "number" ? args["fromPage"] : 1;
        const to = typeof args["toPage"] === "number" ? args["toPage"] : 99;
        return pagesRead(id, from, to);
      }
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

async function turn(said: string, answer: string) {
  const script: readonly FakeBehaviour[] = [
    { kind: "TEXT", text: JSON.stringify(analyst(answer)) },
  ];
  const alpha = createFakeModelProvider({ code: "alpha", script });
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
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: "2026-11-17T10:07:14.000Z",
    } as unknown as QConversationMessage,
  ];
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { role: "USER" | "Q"; content: string }) =>
        Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: input.role,
          content: input.content,
        } as QConversationMessage),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const port = tools();
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: port,
  });
  await seam.answer({
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
    namedOther: { kind: "COMPANY", name: "Nixo" },
    research: Promise.resolve({ mode: "NEVER", announceSourceChange: false }),
  } as unknown as QAnswerRequest);
  const sent = alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");
  const pageReads = port.executed
    .filter((call) => call.name === "read_document_pages")
    .map((call) => call.arguments as Record<string, unknown>);
  return { sent, pageReads };
}

describe("live 17 Nov 2026 (Savanna on Nixo): a figure the shared document states is never said to be unknown", () => {
  it("the live turn: the accounts' burn and runway reach the answer, and the limit fact names the document read", async () => {
    const { sent, pageReads } = await turn(LIVE, LIVE_ANSWER);
    expect(sent).toContain(
      "Net burn (payments less customer receipts) | 125,800",
    );
    expect(sent).toContain("Runway at this month's net burn (months) | 8.8");
    // The contradiction live: profile and deck named as all Q could read,
    // "burn, runway" unknown, beside the page that states both.
    expect(sent).not.toContain(LIMIT_BEFORE);
    // (The facts reach the model as JSON: a quote inside is escaped.)
    expect(sent).toContain(
      `the pages read of the documents Nixo shared with them (\\"${ACCOUNTS.title}\\"`,
    );
    // Page 1 states both measures: nothing further is read.
    const accountsReads = pageReads.filter(
      (args) => args["documentId"] === ACCOUNTS.documentId,
    );
    expect(accountsReads).toEqual([
      expect.objectContaining({ fromPage: 1, toPage: 1 }),
    ]);
  });

  it("a measure the first page does not state is read further into the shared document, and only the pages that state it are given", async () => {
    const { sent, pageReads } = await turn(
      "What are Nixo's net assets and liabilities on its balance sheet?",
      "Nixo's management accounts give total liabilities of 45,000 and net assets of 1,079,550 at 31 October 2026.",
    );
    expect(pageReads).toContainEqual(
      expect.objectContaining({
        documentId: ACCOUNTS.documentId,
        fromPage: 2,
        toPage: 3,
      }),
    );
    // Page 3's balance sheet, from the stored text.
    expect(sent).toContain("Net assets | 1,079,550");
    expect(sent).toContain("Total liabilities | 45,000");
    // Page 2 states no balance-sheet measure: not given.
    expect(sent).not.toContain("Opening cash | 1,890,000");
  });
});

describe("which pages carry an asked figure, read from the stored page text", () => {
  const page = (n: number): Page => {
    const found = ACCOUNTS.pages.find((p) => p.page === n);
    if (found === undefined) throw new Error(`page ${String(n)}`);
    return found;
  };

  it("finds burn and runway on the accounts' first page, and the balance sheet only on its last", () => {
    expect(measuresMissing(LIVE, [page(1)])).toEqual([]);
    const balance = "What are Nixo's net assets and liabilities?";
    const missing = measuresMissing(balance, [page(1)]);
    expect(missing.length).toBe(1);
    expect(
      pagesCarrying([page(2), page(3)], missing).map((p) => p.page),
    ).toEqual([3]);
  });

  it("reads further only within the document, and never past its last page", () => {
    expect(furtherPageRange({ readTo: 1, pageCount: 3 })).toEqual({
      fromPage: 2,
      toPage: 3,
    });
    expect(furtherPageRange({ readTo: 1, pageCount: 9 })).toEqual({
      fromPage: 2,
      toPage: 4,
    });
    expect(furtherPageRange({ readTo: 3, pageCount: 3 })).toBeNull();
    expect(furtherPageRange({ readTo: 1, pageCount: null })).toBeNull();
  });

  it("a limit fact is rewritten only for a company whose shared pages were read", () => {
    const limit = companyFiguresLimitFact("Nixo", {
      published: true,
      deck: "READ",
    });
    expect(limit.statement).toContain(LIMIT_BEFORE);
    const [rewritten] = withSharedDocumentsInLimits(
      [limit],
      new Map([["nixo", [ACCOUNTS.title]]]),
    );
    expect(rewritten?.statement).not.toContain(LIMIT_BEFORE);
    expect(rewritten?.statement).toContain(`"${ACCOUNTS.title}"`);
    expect(rewritten?.statement).toContain(
      "its published figures on Capital Q and the figures its pitch deck states",
    );
    const [other] = withSharedDocumentsInLimits(
      [limit],
      new Map([["tensorgate", [ACCOUNTS.title]]]),
    );
    expect(other).toBe(limit);
  });
});
