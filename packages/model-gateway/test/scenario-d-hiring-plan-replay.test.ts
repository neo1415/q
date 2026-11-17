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
import {
  companyNameCandidates,
  followsReplyAboutACompany,
  lowercaseNameCandidates,
} from "../src/q/named-company-fact.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import {
  alreadyReadLine,
  documentsReadIn,
  readDocumentFor,
} from "../src/q/shared-documents.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Scenario D rerun on d252444b1 (16 Nov 2026, 18:20 UTC; audit
 * 2026-11-16-demo-evidence-live-scenarios.md): Thames Arc's investor, one
 * conversation (8811f9c7). Turn D1 asked about Halyard Security's hiring
 * plan, which was not shared; Halyard's founder then shared "Team and
 * hiring plan" (c0d522b1) with Thames Arc, and turn D2 (run b0a877f8)
 * asked "Break that down for me: how many people per role, and in which
 * quarter does each group start?". Q re-read the data room and read the
 * plan (read_company_document), then:
 *   1. said "4 public-sector account managers" (the plan says 3; parts 16
 *      against the stated 15), and the claim check let it through;
 *   2. cited no page: the read came back pageCount null, text unmarked
 *      (fixed in q-tools: company-documents.test.ts);
 *   3. closed "Want me to ask Halyard Security for a document that would
 *      settle this?" -- code's own offer -- about the plan it had just read;
 *   4. searched companies named "quarter" and "each group start".
 * Replayed in that shape with a fake model and the plan's own text (a
 * synthetic demo document). No provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const THAMES_ARC = "0f000000-0000-4000-8000-0000000000a1";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const PLAN_ID = "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef";
const KPI_ID = "ebdded05-8b00-4e9b-932a-32e87829ac50";
const PLAN_TITLE = "Team and hiring plan";

const ROOM = {
  viewer: "INVESTOR",
  documents: [
    [KPI_ID, "KPI and product metrics pack", "Fundraising summary"],
    [PLAN_ID, PLAN_TITLE, "Team"],
  ].map(([documentId, title, folder]) => ({
    documentId,
    title,
    folder,
    status: "shared with you",
  })),
  openRequests: 0,
};

const PLAN_PAGE = [
  "SYNTHETIC DEMO DOCUMENT - NOT A REAL FINANCIAL OR OFFICIAL RECORD",
  "Team and hiring plan",
  "Hiring plan funded by the seed round",
  "Role | Function | People Start by | Use of funds line",
  "Deployment engineer | Deployment | 6 2027-Q2 | Deployment team for NHS trusts and councils",
  "Product engineer (shared workstations, Engineering | 4 2027-Q2 | Product: shared workstation and lost-device flows",
  "lost devices)",
  "Public-sector account manager | Sales | 3 2027-Q1 | Public-sector sales and framework listings",
  "Information security and assurance | Operations | 1 2027-Q1 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and",
  "manager | G&A",
  "Finance and operations manager | Operations | 1 2027-Q3 | Assurance (Cyber Essentials Plus, DSPT, ISO 27001) and",
  "G&A SYNTHETIC DEMO DOCUMENT",
  "Halyard Security Ltd | Team and hiring plan Version 1.0 | Period: May 2025 to Dec 2027 | Issued 13 Nov 2026 | Page 1/1",
].join("\n");

/** read_company_document's result, as the tool now gives it (paged). */
const PLAN_READ = {
  status: "READ",
  documentId: PLAN_ID,
  title: PLAN_TITLE,
  folder: "Team",
  pageCount: 1,
  text: `[p. 1] ${PLAN_PAGE}`,
  truncated: false,
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
};

const KPI_READ = {
  status: "READ",
  documentId: KPI_ID,
  title: "KPI and product metrics pack",
  folder: "Fundraising summary",
  pageCount: 1,
  pages: [
    {
      page: 1,
      text: "NHS trusts, health boards and councils | 3 | 3 | 3 | 4 | 4 | 4\nLicensed seats | 16,800 | 17,900 | 19,400 | 21,600 | 22,700 | 24,000\nNet burn GBP 92,340; cash GBP 388,070; runway 4.2 months at this burn.",
    },
  ],
  truncated: false,
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
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
  offered("read_company_document", "company.data_room.document.read"),
  offered("list_schedule", "schedule.list"),
  offered("list_pending_approvals", "approvals.pending.list"),
  offered("list_q_work", "q.work.list"),
  offered("diligence_documents", "app.diligence.request", "SIDE_EFFECT"),
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
        // Only Halyard Security is a company of that name; anything else
        // finds nothing (production: "quarter" found nothing).
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
      case "read_company_deck":
        return {
          viewer: "INVESTOR",
          deck: null,
          confirmedByFounder: true,
          truthClass: "USER_CLAIM",
          sections: [],
        };
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
        return args["documentId"] === KPI_ID
          ? KPI_READ
          : args["documentId"] === PLAN_ID
            ? {
                ...KPI_READ,
                ...PLAN_READ,
                pages: [{ page: 1, text: PLAN_PAGE }],
              }
            : null;
      case "read_company_document":
        return PLAN_READ;
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
          investorOrganisationId: THAMES_ARC,
        },
      },
    ],
  } as unknown as PermittedContextPlan;
}

const D1 =
  "What does Halyard Security's hiring plan say about the roles they'll recruit in 2027 with the seed money, and when each one starts?";
const D1_ANSWER =
  "Halyard Security’s hiring plan is not among the authorised materials I can read. The available deck gives a 35% allocation to the deployment team, but it does not specify which 2027 roles that funds or when each role starts.";
const D2 =
  "Break that down for me: how many people per role, and in which quarter does each group start?";
/** The live answer's prose, word for word (the 4 is the wrong figure). */
const D2_LIVE =
  "Halyard Security’s hiring plan names five 2027 groups, adding 15 people in total if the planned seed round closes: 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3. The plan does not give a specific month or day within each quarter. These are projected hires, not actual results.";
const GAP =
  "The hiring plan gives quarters rather than exact start months or dates, so the timing within each quarter is not established.";

async function d2Turn(spoken?: string) {
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TOOL_CALLS",
        calls: [
          {
            callId: "read-plan",
            name: "read_company_document",
            arguments: { companyId: HALYARD, document: PLAN_TITLE },
          },
        ],
      },
      {
        kind: "TEXT",
        text: JSON.stringify(
          analyst(D2_LIVE, {
            ...(spoken === undefined ? {} : { spoken }),
            uncertainties: [
              {
                statement: GAP,
                standing: "REPORTED",
                material: true,
                mattersFor: ["THESIS"],
                resolveBy: ["REQUEST_DOCUMENT"],
              },
            ],
          }),
        ),
      },
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
  const started = Date.parse("2026-11-16T18:19:26.000Z");
  const turns: {
    readonly role: "USER" | "Q";
    readonly content: string;
    readonly blocks?: unknown;
  }[] = [
    { role: "USER", content: D1 },
    {
      role: "Q",
      content: D1_ANSWER,
      blocks: [{ kind: "COMPANY_REFERENCE", companyId: HALYARD }],
    },
    { role: "USER", content: D2 },
  ];
  const messages: QConversationMessage[] = turns.map(
    (message, index) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: CONVERSATION,
        runId: RUN,
        role: message.role,
        content: message.content,
        contentType: "TEXT",
        ...(message.blocks === undefined ? {} : { blocks: message.blocks }),
        createdAt: new Date(started + index * 25_000).toISOString(),
      }) as unknown as QConversationMessage,
  );
  const completed: {
    message: { text: string; spoken?: { text: string } };
  }[] = [];
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
          completed.push(
            input.payload as {
              message: { text: string; spoken?: { text: string } };
            },
          );
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
  // Production warms the turn's reads while the reader runs.
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  return {
    outcome,
    said: completed.at(-1)?.message.text ?? "",
    spokenForm: completed.at(-1)?.message.spoken?.text ?? null,
    executed: tools.executed,
  };
}

describe("scenario D rerun on d252444b1: Thames Arc on Halyard's newly shared hiring plan (run b0a877f8)", () => {
  it("states the plan's own count, so the parts add up to the stated total", async () => {
    const { outcome, said } = await d2Turn();
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).toContain("3 public-sector account managers");
    expect(said).not.toContain("4 public-sector account managers");
    expect(said).toContain("6 deployment engineers and 4 product engineers");
    expect(said).toContain("adding 15 people in total");
  });

  it("offers no request for a document it has just read, and says it read it", async () => {
    const { outcome, said } = await d2Turn();
    expect(said).not.toMatch(/a document that would settle this/iu);
    expect(outcome.kind === "ANSWERED" ? outcome.offer : null).toBeUndefined();
    expect(said).toContain(
      alreadyReadLine("Halyard Security", PLAN_TITLE).slice(0, 60),
    );
  });

  it("searches no company named by the question's own words", async () => {
    const { executed } = await d2Turn();
    const searched = executed
      .filter((call) => call.name === "search_companies")
      .map((call) => (call.arguments as Record<string, unknown>)["query"]);
    expect(searched).not.toContain("quarter");
    expect(searched).not.toContain("each group start");
  });
});

describe("voice directive 15 Nov: the spoken form is held to the answer's claim check", () => {
  it("a wrong count in the spoken form is spoken as the plan states it", async () => {
    const { said, spokenForm } = await d2Turn(
      "The plan starts 4 public-sector account managers in Q1. Then 6 deployment engineers and 4 product engineers start in Q2.",
    );
    expect(said).toContain("3 public-sector account managers");
    // Without the check this passed spokenFormWithin: the answer holds a 4.
    expect(spokenForm).not.toBeNull();
    expect(spokenForm).toContain("3 public-sector account managers");
    expect(spokenForm).not.toContain("4 public-sector account managers");
  });

  it("a sentence the claim check drops is not spoken; the rest is", async () => {
    const { spokenForm } = await d2Turn(
      "The plan adds 16 people in total: 6 deployment engineers and 4 product engineers in Q2. The plan gives quarters only.",
    );
    expect(spokenForm).toBe("The plan gives quarters only.");
  });
});

describe("the principles, by themselves", () => {
  it("common words are not lowercase company names", () => {
    expect(companyNameCandidates(D2, 2)).toEqual([]);
    expect(lowercaseNameCandidates(D2)).toEqual([]);
    // A lowercase company is still a candidate on a fresh question.
    expect(
      lowercaseNameCandidates("what are the risks with northwind ledger?"),
    ).toEqual(["northwind ledger"]);
  });

  it("a turn after Q's reply about a company is about that company", () => {
    expect(
      followsReplyAboutACompany([
        { role: "USER" },
        { role: "Q", blocks: [{ kind: "COMPANY_REFERENCE" }] },
      ]),
    ).toBe(true);
    expect(
      followsReplyAboutACompany([{ role: "Q", blocks: [{ kind: "CHART" }] }]),
    ).toBe(false);
    expect(followsReplyAboutACompany([])).toBe(false);
  });

  it("the documents read in a run, and the one an uncertainty is about", () => {
    const titles = documentsReadIn({
      facts: [
        {
          statement:
            'DATA ROOM DOCUMENT: "KPI and product metrics pack", 1 page …',
          source: 'Data room: "KPI and product metrics pack"',
        },
        {
          statement: 'DATA ROOM, HELD BACK: "Bank statement". …',
          source: 'Data room: "Bank statement"',
        },
      ],
      toolResults: [
        {
          role: "TOOL",
          name: "read_company_document",
          content: JSON.stringify({ ok: true, data: PLAN_READ }),
        },
        {
          role: "TOOL",
          name: "read_company_document",
          content: JSON.stringify({
            ok: true,
            data: { status: "ON_REQUEST", title: "IP assignment deeds" },
          }),
        },
      ],
    });
    expect(titles).toEqual(["KPI and product metrics pack", PLAN_TITLE]);
    expect(readDocumentFor(GAP, titles)).toBe(PLAN_TITLE);
    // An uncertainty about something no read document is about.
    expect(
      readDocumentFor(
        "Whether the NHS framework contract has been signed.",
        titles,
      ),
    ).toBeNull();
  });
});
