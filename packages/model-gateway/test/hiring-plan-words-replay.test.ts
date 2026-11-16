import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
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
import {
  checkAnswer,
  claimCorpus,
  figuresGrounded,
  statesCounts,
} from "../src/q/claim-check.js";
import { createConversationRecall } from "../src/q/conversation-recall.js";
import { documentRowFacts } from "../src/q/document-rows.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";
import {
  DATA_ROOM_READ,
  MANAGEMENT_ACCOUNTS_READ,
  PLAN_CHUNKS,
} from "./live-91bb8564-fixture.js";
import {
  EARLIER_Q_REPLIES,
  EARLIER_SUMMARIES,
  KPI_PACK_READ,
  T1_FINDINGS,
  T1_LIVE,
  T1_QUESTION,
  T2_LIVE,
  T2_QUESTION,
} from "./live-a1777c9a-fixture.js";

/**
 * Live, third time, on production 9c7b38925 (16 Nov 2026, 23:09 UTC),
 * conversation 28071f0c, Thames Arc's investor:
 *
 *   T1 (run a1777c9a, READER lane, COMPLEX_ANALYSIS, TARGETED_RETRIEVAL;
 *      claimCheck runs 3, claimCheckAnswer runs 1, no warning logged)
 *      "Walk me through Halyard Security's 2027 hiring plan by role" ->
 *      "... in Q1, four public-sector account managers and one ...; in Q2,
 *      six ... and four ...; and in Q3, one .... That is 15 planned hires in
 *      total." Findings: "15 people ...: five in Q1, ten in Q2 and one in
 *      Q3", "... four public-sector account managers and one ...".
 *   T2 (run 21272075, answered from the conversation's record by
 *      conversation-recall.ts, no claim check on that path at all)
 *      "How many start in each quarter?" -> "five hires in Q1, ten in Q2,
 *      and one in Q3".
 *
 * Why the 9c7b38925 replay passed and production did not: the replay's
 * model wrote counts as digits ("4 public-sector account managers and 1
 * information ..."), this run's model wrote them as words. A word count
 * was bound only when the words after it ended the item ("four ...
 * managers in Q1"); "four public-sector account managers and one
 * information security and assurance manager" ran on past "and one" into
 * a seven-word item, so no item, no binding. A quarter's count was read
 * from digits only ("5 in Q1"), never "five in Q1". And the follow-up was
 * answered by the conversation-record path, which no check guards.
 *
 * Replayed through the answer entry with a fake model, the run's real
 * stored passages and tool output (live-91bb8564-fixture.ts,
 * live-a1777c9a-fixture.ts), its parallel extras writing the stored
 * findings, and recall carrying Q's earlier replies and summaries in
 * recall's rendering. No provider, no network.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const THAMES_ARC = "cfbc217a-5ba2-407f-a684-084a96d892f7";
const HALYARD = "1ab2cc02-160f-4812-a6b1-8be7e43afd3e";
const GREETING =
  "Welcome back, Amelia. Worth a look. 12 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";

const RETRIEVED: readonly AuthorisedFact[] = PLAN_CHUNKS.map((statement) => ({
  scope: "COMPANY_DOCUMENTS",
  statement,
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
  source: "Team and hiring plan, page 1",
}));

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Recall's rendering (q-knowledge memory/render.ts) of the earlier turns. */
const MEMORY = [
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
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_data_room", "company.data_room.read"),
  offered("read_document_pages", "company.data_room.document.pages.read"),
];

function outcomeOf(proposal: QToolProposal, data: unknown): QToolCallOutcome {
  const tool = TOOLS.find((one) => one.definition.name === proposal.name);
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

function toolsFor(): QToolPort {
  const respond = (proposal: QToolProposal): unknown => {
    const args = proposal.arguments as Record<string, unknown>;
    switch (proposal.name) {
      case "search_companies":
        return {
          items: [{ companyId: HALYARD, canonicalName: "Halyard Security" }],
          nextCursor: null,
        };
      case "get_company":
        return { companyId: HALYARD, canonicalName: "Halyard Security" };
      case "read_company_data_room":
        return DATA_ROOM_READ;
      case "read_document_pages":
        return args["documentId"] === KPI_PACK_READ.documentId
          ? KPI_PACK_READ
          : MANAGEMENT_ACCOUNTS_READ;
      default:
        return { items: [] };
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

const findingOf = (finding: {
  readonly type: string;
  readonly statement: string;
}) => ({
  type: finding.type,
  statement: finding.statement,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: finding.type === "UNCERTAINTY" ? "HIGH" : "MODERATE",
  basis: ["F1"],
});

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

async function t1() {
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      { kind: "JSON", value: analyst(T1_LIVE) },
      {
        kind: "JSON",
        value: { ...analyst("."), findings: T1_FINDINGS.map(findingOf) },
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
  const started = Date.parse("2026-11-16T23:09:28.000Z");
  const history = [
    { role: "Q", content: GREETING },
    { role: "USER", content: T1_QUESTION },
  ] as const;
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
        createdAt: new Date(started + index * 100).toISOString(),
      }) as unknown as QConversationMessage,
  );
  const events: { type: string; payload: unknown }[] = [];
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
        events.push({ type: input.eventType ?? "", payload: input.payload });
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
    parallelExtras: true,
    logger: recordingLogger(logged),
    memory: { recall: () => Promise.resolve(MEMORY) },
    context: {
      assemble: () =>
        Promise.resolve({
          facts: RETRIEVED,
          subjectDescription: `${String(RETRIEVED.length)} passage(s) retrieved from source documents you are authorised to use; each is source material, not verified fact`,
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
    executionClass: "COMPLEX_ANALYSIS",
  } as unknown as QAnswerRequest;
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  const completed = events
    .filter((event) => event.type === "q.message.completed")
    .map(
      (event) =>
        event.payload as {
          message: {
            text: string;
            blocks?: readonly {
              kind: string;
              finding?: { statement: string };
            }[];
          };
        },
    )
    .at(-1);
  const findings = (completed?.message.blocks ?? [])
    .filter((block) => block.kind === "FINDING")
    .map((block) => block.finding?.statement ?? "");
  const shownLive = events
    .filter((event) => event.type === "q.finding.available")
    .map(
      (event) =>
        (event.payload as { finding: { statement: string } }).finding.statement,
    );
  return {
    outcome,
    said: completed?.message.text ?? "",
    findings,
    shownLive,
    logged,
  };
}

describe("live on 9c7b38925: Halyard's hiring plan, its counts written as words (run a1777c9a)", () => {
  it("T1: a count in words is bound to its row, put right where the sentence recites the rows", async () => {
    const { outcome, said } = await t1();
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).not.toContain("four public-sector account managers");
    expect(said).toContain("3 public-sector account managers");
    expect(said).toContain(
      "six deployment engineers and four product engineers",
    );
    expect(said).toContain("That is 15 planned hires in total.");
  });

  it("T1: a finding whose quarter or role count the rows contradict is neither shown live nor stored", async () => {
    const { findings, shownLive } = await t1();
    for (const statements of [findings, shownLive]) {
      expect(statements.join("\n")).not.toContain("five in Q1");
      expect(statements.join("\n")).not.toContain(
        "four public-sector account managers",
      );
      // The findings the rows hold stay.
      expect(statements).toContain(
        "In Q2 2027, Halyard Security plans to hire six deployment engineers and four product engineers.",
      );
    }
  });

  it("T1: the claim check logs what it did, by kind, with no text", async () => {
    const { logged } = await t1();
    const line = logged.find((one) => one.msg === "q claim check");
    expect(line).toBeDefined();
    const fields = line?.fields ?? {};
    expect(fields).toMatchObject({
      sources: expect.objectContaining({
        retrieved: RETRIEVED.length,
        memory: 1,
      }) as unknown,
      answer: expect.objectContaining({
        corrected: 1,
      }) as unknown,
    });
    const answer = fields["answer"] as Record<string, number>;
    expect(answer["examined"]).toBeGreaterThanOrEqual(5);
    expect(answer["bound"]).toBeGreaterThanOrEqual(4);
    const findings = fields["findings"] as Record<string, number>;
    expect(findings["dropped"]).toBe(2);
    // No figure or wording of the answer is in the line.
    expect(JSON.stringify(fields)).not.toMatch(/account manager|Halyard/iu);
  });
});

describe("the follow-up answered from the conversation's record (run 21272075)", () => {
  const recallWith = (say: string) => {
    const fake = createFakeModelProvider({
      code: "alpha",
      script: [{ kind: "JSON", value: { answerable: true, say } }],
    });
    const gateway = createModelGateway({
      catalog: createStaticModelCatalog(testCatalog()),
      registry: createModelProviderRegistry([fake]),
      usage: createInMemoryModelUsageRepository(),
      sleep: () => Promise.resolve(),
    });
    const logged: Logged[] = [];
    const recall = createConversationRecall({
      gateway,
      logger: recordingLogger(logged),
    });
    const request = {
      runId: RUN,
      tenantId: TENANT,
      actor: ActorContextSchema.parse({
        userId: USER,
        tenantId: TENANT,
        actorType: "HUMAN",
      }),
      correlationId: `cor_${RUN}`,
      plan: plan(),
    } as unknown as QAnswerRequest;
    return {
      logged,
      said: recall(request, {
        said: T2_QUESTION,
        recent: [
          { role: "USER", text: T1_QUESTION },
          { role: "Q", text: T1_LIVE },
        ],
        shown: `T1 (Q): ${T1_LIVE}`,
        turn: 1,
      }),
    };
  };

  it("a reply that states counts goes the full, checked way; one that states none is kept", async () => {
    const counted = recallWith(T2_LIVE);
    expect(await counted.said).toBeNull();
    expect(
      counted.logged.some(
        (one) => one.msg === "a follow-up stating counts goes the full way",
      ),
    ).toBe(true);
    const plain = recallWith(
      "The plan gives quarters, not specific months or days.",
    );
    expect(await plain.said).toBe(
      "The plan gives quarters, not specific months or days.",
    );
  });
});

describe("counts written as words, held to the rows", () => {
  const today = new Date("2026-11-16T23:09:00Z");
  const corpus = claimCorpus(
    [...PLAN_CHUNKS, ...documentRowFacts(RETRIEVED).map((f) => f.statement)],
    today,
    [MEMORY],
  );

  it("the live answer: the account managers' count put right, the rest kept", () => {
    const out = checkAnswer(T1_LIVE, corpus);
    expect(out.text).toContain(
      "in Q1, 3 public-sector account managers and one information security and assurance manager",
    );
    expect(out.text).toContain("That is 15 planned hires in total.");
  });

  it("the live findings: the two the rows contradict are left out", () => {
    const kept = T1_FINDINGS.filter((finding) =>
      figuresGrounded(finding.statement, corpus),
    ).map((finding) => finding.statement);
    expect(kept).toHaveLength(T1_FINDINGS.length - 2);
    expect(kept.join("\n")).not.toMatch(/five in Q1|four public-sector/u);
  });

  it("a quarter's count in words is held to the rows starting then", () => {
    expect(
      checkAnswer("Halyard plans four hires in Q1 2027.", corpus).text,
    ).toContain("four hires in Q1 2027");
    expect(
      checkAnswer("Halyard plans five hires in Q1 2027.", corpus).text,
    ).not.toContain("five hires");
  });

  it("Q's earlier summaries, recalled, bind no word count", () => {
    const memoryOnly = claimCorpus([PLAN_CHUNKS[8] ?? ""], today, [MEMORY]);
    expect(
      figuresGrounded(
        "Q1 includes four public-sector account managers and one information security and assurance manager.",
        memoryOnly,
      ),
    ).toBe(false);
  });

  it("what states a count", () => {
    expect(statesCounts(T2_LIVE)).toBe(true);
    expect(statesCounts("five hires in Q1")).toBe(true);
    expect(statesCounts("3 public-sector account managers")).toBe(true);
    expect(statesCounts("The plan gives quarters, not months.")).toBe(false);
    expect(statesCounts("One of them starts in Q3.")).toBe(false);
  });
});
