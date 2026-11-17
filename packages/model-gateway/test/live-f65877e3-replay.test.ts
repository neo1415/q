import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { CompanyAnalystResult } from "@capital-q/q-core";
import type {
  QAnswerRequest,
  QConversationFetch,
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
import { dataRoomDocumentFacts } from "../src/q/data-room-document-fact.js";
import { documentRowFacts } from "../src/q/document-rows.js";
import {
  createModelGatewayQAnswer,
  toolResultMessage,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";
import {
  EARLIER_Q_REPLIES,
  EARLIER_SUMMARIES,
  F65877E3_QUESTION,
  F65877E3_SHOWN,
  F65877E3_TOOL_RESULTS,
  S7E866011_QUESTION,
  S7E866011_TOOL_RESULTS,
  S7E866011_UNCERTAINTY,
  type StoredToolResult,
} from "./live-f65877e3-fixture.js";

/**
 * Live on production 2fb61c5dc (17 Nov 2026, 05:32 UTC), conversation
 * fecf46ac, Thames Arc's investor:
 *
 *   run f65877e3 "List Halyard Security's 2027 hiring plan by role" ->
 *     shown: "That is 15 planned hires in total. The plan is the company's
 *     own projection, not verified headcount." The role list was dropped.
 *     q claim check: sources {facts 44, retrieved 0, documentRows 0,
 *     toolResults 0, memory 1, earlierReplies 1}, corpus {tables 4,
 *     quarters 3}, answer {examined 5, bound 0, contradicted 1,
 *     corrected 0, unplaced 4, dropped 1}.
 *   run 7e866011 "How many of those start in Q1?" -> shown only "The plan
 *     is the company's own projection, conditional on the seed round
 *     closing." beside an UNCERTAINTY block saying "four public-sector
 *     account managers ... five" (corpus {tables 0}: the turn read no
 *     document; the plan was in the conversation's record of T1 only).
 *
 * Code itself had read the plan before the model answered (the shared
 * documents' pre-read: company.data_room.document.pages.read for "Team
 * and hiring plan"), yet the model was never handed its rows, so it
 * repeated recalled counts; the check then dropped the list rather than
 * put its one wrong count right; and the follow-up held no document at
 * all. Replayed here from the stored tool results
 * (live-f65877e3-fixture.ts) through the answer entry with a fake model
 * whose words follow Q's earlier replies (the shown sentences are the
 * live ones verbatim). No provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const THAMES_ARC = "cfbc217a-5ba2-407f-a684-084a96d892f7";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const PLAN_ID = "c0d522b1-ca99-4e7d-ad83-cb99ba7326ef";
const GREETING =
  "Welcome back, Amelia. Worth a look. 12 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";

/**
 * T1's model answer: the role list as Q's earlier reply in 28071f0c wrote
 * it (recalled, with its wrong "four public-sector account managers"),
 * then the two sentences the person saw, verbatim.
 */
const T1_MODEL =
  "By role: in Q1, four public-sector account managers and one information security and assurance manager; in Q2, six deployment engineers and four product engineers; and in Q3, one finance and operations manager. That is 15 planned hires in total. The plan is the company’s own projection, not verified headcount.";
/** The same list as a bulleted list with digits (how a list is often written). */
const T1_MODEL_LIST =
  "Halyard Security’s Team and hiring plan lists these planned 2027 hires:\n\n- 6 deployment engineers (Q2 2027)\n- 4 product engineers (Q2 2027)\n- 4 public-sector account managers (Q1 2027)\n- 1 information security and assurance manager (Q1 2027)\n- 1 finance and operations manager (Q3 2027)\n\nThat is 15 planned hires in total. The plan is the company’s own projection, not verified headcount.";
/** T2's model answer, as the stored UNCERTAINTY block reasoned it. */
const T2_MODEL =
  "Five planned hires start in Q1 2027: four public-sector account managers and one information security and assurance manager. The plan is the company’s own projection, conditional on the seed round closing.";

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Recall's rendering (q-knowledge memory/render.ts) of the earlier turns. */
const MEMORY = [
  'Their own earlier conversations, word for word (what was said, not verified evidence; "they said" lines are their own words, "Q said" lines are Q\'s):',
  ...EARLIER_Q_REPLIES.map(
    (reply) =>
      `- 2026-11-17 (in "Halyard Security hiring plan"), Q said: "${clip(reply.replace(/\s+/gu, " ").trim(), 320)}"`,
  ),
  "",
  "Earlier conversations about what they asked (Q said earlier (its summary, not a source)):",
  ...EARLIER_SUMMARIES.map(
    (summary) =>
      `- 2026-11-17 Halyard Security hiring plan: ${clip(summary, 600)}`,
  ),
].join("\n");

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
  offered("read_company_deck", "company.deck.read"),
  offered("get_relationship", "relationship.get"),
  offered("read_company_data_room", "company.data_room.read"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
  offered("list_schedule", "schedule.list"),
  offered("list_pending_approvals", "approvals.pending.list"),
  offered("list_q_work", "q.work.list"),
  offered("get_investor_mandate", "investor_mandate.get"),
];

/** The stored result a run's call of this tool, with these arguments, got. */
function storedFor(
  stored: readonly StoredToolResult[],
  toolName: string,
  args: Record<string, unknown>,
): unknown {
  const ofTool = stored.filter((row) => row.toolName === toolName);
  const documentId = args["documentId"];
  const exact = ofTool.find(
    (row) =>
      documentId === undefined ||
      (row.arguments as Record<string, unknown>)["documentId"] === documentId,
  );
  return exact?.result ?? null;
}

const STORED: readonly StoredToolResult[] = [
  ...F65877E3_TOOL_RESULTS,
  ...S7E866011_TOOL_RESULTS,
];

/** Which documents a turn read as pages, in order. */
const pagesRead: string[] = [];

function toolsFor(): QToolPort {
  return {
    offer: () => Promise.resolve(TOOLS),
    available: () => Promise.resolve(TOOLS),
    execute: (proposal: QToolProposal) => {
      const tool = TOOLS.find((one) => one.definition.name === proposal.name);
      const toolName = tool?.toolName ?? proposal.name;
      const args = (proposal.arguments ?? {}) as Record<string, unknown>;
      if (proposal.name === "read_document_pages") {
        pagesRead.push(String(args["documentId"]));
      }
      const data = storedFor(STORED, toolName, args);
      const outcome: QToolCallOutcome =
        data === null
          ? {
              callId: proposal.callId,
              toolName,
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
              toolName,
              toolVersion: 1,
              classification: "READ_ONLY",
              status: "SUCCEEDED",
              failureCode: null,
              sensitivity: "CONFIDENTIAL",
              result: { ok: true, data },
              latencyMs: 2,
            };
      return Promise.resolve(outcome);
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

type Logged = {
  readonly msg: string;
  readonly fields: Record<string, unknown>;
};

function recordingLogger(into: Logged[]): Logger {
  const at =
    () =>
    (fields: unknown, msg?: string): void => {
      into.push({
        msg: msg ?? "",
        fields:
          typeof fields === "object" && fields !== null
            ? (fields as Record<string, unknown>)
            : {},
      });
    };
  const logger = {
    info: at(),
    warn: at(),
    error: at(),
    debug: at(),
    trace: at(),
    fatal: at(),
    child: () => logger,
  };
  return logger;
}

type Turn = {
  readonly said: string;
  readonly prompt: string;
  readonly logged: readonly Logged[];
  readonly kind: string;
};

async function turn(input: {
  readonly history: readonly {
    readonly role: "USER" | "Q";
    readonly content: string;
    readonly runId?: string;
  }[];
  readonly modelSays: string;
  /** What earlier runs of this conversation fetched (conversation_tool_results). */
  readonly fetched?: readonly QConversationFetch[];
}): Promise<Turn> {
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      { kind: "TEXT", text: JSON.stringify(analyst(input.modelSays)) },
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
  const started = Date.parse("2026-11-17T05:32:50.000Z");
  const messages: QConversationMessage[] = input.history.map(
    (message, index) =>
      ({
        id: randomUUID(),
        tenantId: TENANT,
        conversationId: CONVERSATION,
        runId: message.runId ?? RUN,
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
      insert: (_tx: unknown, row: { role: "USER" | "Q"; content: string }) => {
        const message = {
          ...messages[0],
          id: randomUUID(),
          role: row.role,
          content: row.content,
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
        event: { eventType?: string; payload?: unknown },
      ) => {
        if (event.eventType === "q.message.completed") {
          completed.push(event.payload as { message: { text: string } });
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const logged: Logged[] = [];
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: toolsFor(),
    logger: recordingLogger(logged),
    memory: {
      recall: () =>
        Promise.resolve({
          text: MEMORY,
          ownWords: [],
          earlierSummaries: [],
        }),
    },
    // Live: retrieved 0. Nothing of the plan came as a passage.
    context: {
      assemble: () =>
        Promise.resolve({
          facts: [],
          subjectDescription: "0 passage(s) retrieved",
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
    ...(input.fetched === undefined
      ? {}
      : { fetchedInConversation: input.fetched }),
  } as unknown as QAnswerRequest;
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  return {
    kind: outcome.kind,
    said: completed.at(-1)?.message.text ?? "",
    prompt: fake.calls
      .map((call) =>
        call.request.messages.map((message) => message.content).join("\n"),
      )
      .join("\n"),
    logged,
  };
}

const T1_RUN = "f65877e3-a3af-45d9-80c9-fae8bda0a1fb";

const t1 = (modelSays: string): Promise<Turn> =>
  turn({
    history: [
      { role: "Q", content: GREETING, runId: T1_RUN },
      { role: "USER", content: F65877E3_QUESTION, runId: T1_RUN },
    ],
    modelSays,
  });

/** T1's stored fetches, as the follow-up reads them back. */
const T1_FETCHED: readonly QConversationFetch[] = F65877E3_TOOL_RESULTS.map(
  (row) => ({
    runId: T1_RUN,
    toolName: row.toolName,
    arguments: row.arguments,
    result: row.result,
    sensitivity: "CONFIDENTIAL",
    fetchedAt: row.fetchedAt,
  }),
);

const t2 = (modelSays: string): Promise<Turn> =>
  turn({
    history: [
      { role: "Q", content: GREETING, runId: T1_RUN },
      { role: "USER", content: F65877E3_QUESTION, runId: T1_RUN },
      { role: "Q", content: F65877E3_SHOWN, runId: T1_RUN },
      { role: "USER", content: S7E866011_QUESTION },
    ],
    modelSays,
    fetched: T1_FETCHED,
  });

const claimLine = (logged: readonly Logged[]) =>
  logged.find((entry) => entry.msg === "q claim check")?.fields;

const ROLES = [
  /\b(?:6|six) deployment engineers\b/u,
  /\b(?:4|four) product engineers\b/u,
  /\b3 public-sector account managers\b/u,
  /\b(?:1|one) information security and assurance manager\b/u,
  /\b(?:1|one) finance and operations manager\b/u,
];

describe("live f65877e3 on 2fb61c5dc: the plan code read before the model answered", () => {
  it("its rows are in front of the model before it answers", async () => {
    const { prompt } = await t1(T1_MODEL);
    expect(prompt).toContain(
      "Public-sector account manager: 3 (starts 2027-Q1)",
    );
    expect(prompt).toContain("Starting 2027-Q1: 4 in all");
  });

  it("the list keeps all five roles, the account managers put right to the row's 3", async () => {
    for (const answer of [T1_MODEL, T1_MODEL_LIST]) {
      const { kind, said } = await t1(answer);
      expect(kind).toBe("ANSWERED");
      for (const role of ROLES) expect(said).toMatch(role);
      expect(said).not.toMatch(/\b(?:4|four) public-sector/iu);
      expect(said).toContain("15 planned hires");
    }
  });

  it("the claim check counts the read document as a source with its rows", async () => {
    const { logged } = await t1(T1_MODEL);
    const line = claimLine(logged);
    const sources = line?.["sources"] as Record<string, number> | undefined;
    expect(sources?.["documents"]).toBeGreaterThanOrEqual(1);
    expect(sources?.["documentRows"]).toBeGreaterThanOrEqual(1);
    const answer = line?.["answer"] as Record<string, number> | undefined;
    expect(answer?.["bound"]).toBeGreaterThanOrEqual(4);
    expect(answer?.["dropped"]).toBe(0);
  });
});

describe("live 7e866011: the follow-up holds the plan T1 read", () => {
  it("Q1 is the rows' 4, and the account managers the row's 3", async () => {
    const { kind, said, prompt } = await t2(T2_MODEL);
    expect(kind).toBe("ANSWERED");
    expect(prompt).toContain("Starting 2027-Q1: 4 in all");
    expect(said).toMatch(/\b4 planned hires start in Q1 2027\b/u);
    expect(said).toContain("3 public-sector account managers");
    expect(said).not.toMatch(/\b(?:five|5)\b/iu);
    expect(said).not.toMatch(/\b(?:4|four) public-sector/iu);
  });

  it("the stored UNCERTAINTY's counts are held to the rows too", () => {
    const corpus = claimCorpus(
      documentRowFacts(planFacts()).map((fact) => fact.statement),
      new Date("2026-11-17T05:33:10Z"),
    );
    expect(checkAnswer(S7E866011_UNCERTAINTY, corpus).text).not.toMatch(
      /\bfour public-sector/iu,
    );
  });
});

/** The plan's page read, as the shared pre-read turns it into a fact. */
function planFacts() {
  const read = F65877E3_TOOL_RESULTS.find(
    (row) =>
      (row.arguments as Record<string, unknown>)["documentId"] === PLAN_ID,
  );
  return dataRoomDocumentFacts(read?.result, {
    companyId: HALYARD,
    documentId: PLAN_ID,
    open: false,
    shared: true,
  });
}

describe("every document text the run read gets its rows", () => {
  it("a shared pre-read (a data-room document fact) gets the rows fact", () => {
    const rows = documentRowFacts(planFacts()).map((fact) => fact.statement);
    expect(rows.join("\n")).toContain(
      "Public-sector account manager: 3 (starts 2027-Q1)",
    );
  });

  it("a page read the model made itself carries the rows in its result", () => {
    const read = F65877E3_TOOL_RESULTS.find(
      (row) =>
        (row.arguments as Record<string, unknown>)["documentId"] === PLAN_ID,
    );
    const message = toolResultMessage(
      { callId: "c1", name: "read_document_pages", arguments: {} },
      {
        callId: "c1",
        toolName: "company.data_room.document.pages.read",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "CONFIDENTIAL",
        result: { ok: true, data: read?.result },
        latencyMs: 1,
      },
    );
    expect(message.content).toContain(
      "Public-sector account manager: 3 (starts 2027-Q1)",
    );
  });

  it("the page text's own layout binds each role's count", () => {
    const corpus = claimCorpus(
      planFacts().map((fact) => fact.statement),
      new Date("2026-11-17T05:32:55Z"),
      [MEMORY],
    );
    const out = checkAnswer(T1_MODEL, corpus);
    for (const role of ROLES) expect(out.text).toMatch(role);
    expect(out.stats.counts.bound).toBeGreaterThanOrEqual(4);
  });
});

describe("rows are the authority: a contradicted count is put right, not dropped", () => {
  const corpus = () =>
    claimCorpus(
      planFacts().map((fact) => fact.statement),
      new Date("2026-11-17T05:32:55Z"),
      [MEMORY],
    );

  it("a single count of one role, with no total restated", () => {
    expect(
      checkAnswer(
        "Halyard plans 4 public-sector account managers in Q1.",
        corpus(),
      ).text,
    ).toBe("Halyard plans 3 public-sector account managers in Q1.");
  });

  it("a quarter's count said alone", () => {
    expect(
      checkAnswer("Five planned hires start in Q1 2027.", corpus()).text,
    ).toBe("4 planned hires start in Q1 2027.");
  });

  it("a count said of what already happened is not the plan's: left out, never rewritten", () => {
    const out = checkAnswer(
      "Halyard hired 2 deployment engineers in July.",
      corpus(),
    ).text;
    expect(out).not.toContain("6 deployment engineers");
    expect(out).not.toContain("2 deployment engineers");
  });

  it("memory and earlier replies never outrank the rows", () => {
    const out = checkAnswer(T2_MODEL, corpus()).text;
    expect(out).toContain("3 public-sector account managers");
    expect(out).not.toMatch(/\bfive\b/iu);
  });
});
