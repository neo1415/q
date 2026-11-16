import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ArrivalSnapshotSchema,
  PermittedContextPlanSchema,
  QAccountDigestSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type ArrivalSnapshot,
} from "@capital-q/contracts";
import {
  ModelCatalogSnapshotSchema,
  type ModelCatalogSnapshot,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  type ModelProvider,
} from "@capital-q/model-gateway";
import {
  createModelGatewayQAnswer,
  type QTurnReader,
  type QTurnSkimmer,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QLiveDelta,
  QOfferedTool,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer, type QRunRouting } from "../src/answer.js";

/**
 * Live re-check of 6f9b63cc5 (16 Nov 2026, docs/ai-handoff/audits/
 * 2026-11-15-q-voice-audit/live-recheck-3b7145616.md, "Follow-up on
 * 6f9b63cc5"): a shown-list explanation ("How come it made the list?",
 * "What put the second one in the first list above the rest?") was answered
 * correctly from its card, 0 tools, in place -- in 13-15 s. Model usage:
 * the reader (2.0-2.2 s), the skim (0.25 s), a third FAST_CLASSIFICATION
 * (1.4 s, run 1 only) and one NORMAL_DIALOGUE answer call of 7.3-7.8 s
 * whose text reached the client only with q.message.completed, after its
 * findings.
 *
 * Replayed through the composition q-api runs (the specialist seam over the
 * conversational gateway answer, the real model gateway) on a virtual clock
 * with production-shaped latencies; only the providers are fakes:
 *   turn reader      2,000 ms
 *   turn skim          250 ms
 *   arrival skim     1,400 ms (TURN_SKIM's arrival fallback, the gateway's)
 *   retrieval        1,500 ms (evidence assemble: the query embedding, the
 *                    hybrid search and the knowledge reads, each a network
 *                    hop to the database); asked as the turn arrives (warm)
 *                    and, on current code, again with the reading's focus
 *   answer model     first token 1,000 ms after the call, then 125
 *                    tokens/s (about four characters a token)
 *   a read / write      10 ms
 * Target (Phase 3, deliverable D): first answer text <= 3.5 s, complete
 * <= 6 s; the answer streamed (q.message.delta before its findings and its
 * completion); the answer call asked within ~300 ms of the reading; no
 * classification call beyond the reader and the skim.
 */

const LATENCY = {
  readerMs: 2_000,
  skimMs: 250,
  arrivalSkimMs: 1_400,
  retrievalMs: 1_500,
  firstTokenMs: 1_000,
  tokensPerSecond: 125,
  dbMs: 10,
} as const;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const MEDTRAIL = "3ab2cc02-160f-4812-a6b1-000000000001";
const MIZAN = "3ab2cc02-160f-4812-a6b1-000000000002";
const BARIDI = "3ab2cc02-160f-4812-a6b1-000000000003";
const KESHO = "3ab2cc02-160f-4812-a6b1-000000000004";
const NAFASI = "3ab2cc02-160f-4812-a6b1-000000000005";
const OTHER = "7b1c0e55-0000-4000-8000-000000000001";
const REL = "7b1c0e55-0000-4000-8000-000000000002";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function catalog(): ModelCatalogSnapshot {
  const provider = "b1000000-0000-4000-8000-000000000001";
  const model = "b2000000-0000-4000-8000-000000000001";
  return ModelCatalogSnapshotSchema.parse({
    providers: [
      {
        id: provider,
        code: "timed",
        name: "Timed (recorded latencies)",
        status: "ACTIVE",
        privacyPolicyClass: "NO_TRAINING_ZERO_RETENTION",
        supportsZeroRetention: true,
        regionSupport: ["global"],
      },
    ],
    models: [
      {
        id: model,
        providerId: provider,
        modelCode: "timed-answer",
        modelFamily: "timed",
        modelType: "TEXT_GENERATION",
        status: "ACTIVE",
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsVision: false,
        supportsAudio: false,
        supportsRealtime: false,
        supportsPromptCache: false,
        supportsReasoning: false,
        sensitivityCeiling: "RESTRICTED",
        qualityClass: "HIGH",
        latencyClass: "STANDARD",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    prices: [
      {
        id: "b3000000-0000-4000-8000-000000000001",
        modelId: model,
        pricingRegion: "global",
        currency: "USD",
        inputPerMillion: 0,
        cachedInputPerMillion: null,
        outputPerMillion: 0,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ],
    routingPolicies: [
      "NORMAL_DIALOGUE",
      "EVIDENCE_SYNTHESIS",
      "COMPARISON",
      "FAST_CLASSIFICATION",
      "STRUCTURED_EXTRACTION",
      "DEEP_INVESTIGATION",
    ].map((taskClass, index) => ({
      id: `b400000${String(index + 1)}-0000-4000-8000-000000000001`,
      code: `${taskClass.toLowerCase()}.v1`,
      taskClass,
      sensitivityClass: "RESTRICTED",
      qualityFloor: "BASIC",
      latencyTargetMs: 20_000,
      costCeilingUsd: 1,
      preferredModels: [model],
      fallbackModels: [],
      allowFreeRouter: false,
      status: "ACTIVE",
      version: 1,
    })),
    loadedAt: "2026-11-16T00:00:00.000Z",
  });
}

/** An arrival item with a named counterpart: the arrival skim's trigger. */
const SNAPSHOT: ArrivalSnapshot = ArrivalSnapshotSchema.parse({
  contractVersion: "arrival-snapshot.v1",
  version: "v-abcdef0123456789",
  asOf: "2026-11-16T05:00:00.000Z",
  unread: [],
  briefsRead: true,
  activity: null,
  items: [
    {
      key: `interest:${REL}`,
      kind: "INTEREST_REQUEST",
      headline: "TensorGate wants to connect and is waiting for your answer",
      availability: "OK",
      counterpart: {
        kind: "INVESTOR_ORGANISATION",
        id: OTHER,
        name: "TensorGate",
      },
      ids: {
        relationshipId: REL,
        companyId: null,
        investorOrganisationId: OTHER,
        meetingId: null,
        approvalId: null,
        jobId: null,
        documentId: null,
        messageId: null,
      },
      facts: {
        request: {
          kind: "CONNECTION_OR_INTEREST",
          from: "TensorGate",
          since: "2026-11-15T10:00:00.000Z",
          summary: "TensorGate wants to connect and is waiting for your answer",
        },
        messageCount: 0,
        latestMessage: null,
        theirLatestMessage: null,
        meeting: null,
        decisions: [],
        documents: [],
        openRequests: [],
        relationshipState: "CONNECTED",
        suggestedNextAction: null,
        note: null,
      },
      openPath: `/relationships/investor/${OTHER}/messages`,
      decidable: true,
      evidence: [],
      sourceVersions: { historySequence: 7, brief: "relationship-brief.v1" },
      since: "2026-11-15T10:00:00.000Z",
      asOf: "2026-11-16T05:00:00.000Z",
    },
  ],
});

const READ_TOOLS: readonly (readonly [string, string])[] = [
  ["discover_companies", "discovery.companies"],
  ["fit_top_candidates", "fit.top_candidates"],
  ["fit_profile", "fit.profile"],
  ["read_company_figures", "company.figures.read"],
  ["list_my_relationships", "relationship.list_mine"],
  ["get_company", "company.get"],
  ["get_relationship", "relationship.get"],
  ["list_schedule", "schedule.list"],
  ["list_pending_approvals", "approvals.pending.list"],
  ["list_q_work", "q.work.list"],
  ["search_companies", "company.search"],
  ["research_public_web", "public_web.search"],
];

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "COMPARING_OPPORTUNITIES",
});

/** What the answer model writes: two sentences, then two findings. */
const ANSWER =
  "Baridi made the list because you asked for the weakest fits outside your sectors that have revenue on record, and it is the only one of those. Its sector does not match your mandate and its geography only partly does, which is why it sits at 6.2.";
const ANSWER_OBJECT = {
  answer: ANSWER,
  responseShape: "CONCISE",
  findings: Array.from({ length: 2 }, (_, index) => ({
    type: ["FACT", "GAP"][index] ?? "FACT",
    statement:
      `Point ${String(index + 1)}: ${"the card's fit reasons ".repeat(8)}`.trim(),
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    confidence: "MODERATE",
    basis: [],
  })),
  missingEvidence: [],
  contradictions: [],
  insufficientEvidence: false,
  recommendation: null,
  clarifyingQuestions: [],
  declined: false,
};

type Trace = { readonly what: string; readonly ms: number };

function answerModel(
  trace: (what: string) => void,
  prompts: { chars: number; text: string }[],
): ModelProvider {
  return {
    code: "timed",
    capabilities: () => ({
      structuredOutput: true,
      toolCalling: true,
      streaming: true,
      cancellation: true,
    }),
    generate: async (request, context) => {
      const text = JSON.stringify(request.messages);
      prompts.push({ chars: text.length, text });
      trace("model asked");
      await wait(LATENCY.firstTokenMs);
      trace("model first token");
      const json = JSON.stringify(ANSWER_OBJECT);
      const piece = 40;
      const perPieceMs = (piece / 4 / LATENCY.tokensPerSecond) * 1_000;
      for (let at = 0; at < json.length; at += piece) {
        context.onTextDelta?.(json.slice(at, at + piece));
        await wait(perPieceMs);
      }
      trace("model done");
      return {
        text: json,
        toolCalls: undefined,
        usage: undefined,
        finish: "COMPLETE",
        modelCode: request.modelCode,
        providerReference: undefined,
      };
    },
  };
}

function plan(runId: string) {
  const subject = {
    kind: "INVESTOR_ORGANISATION" as const,
    investorOrganisationId: ORG,
  };
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: actor.organisationId },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
    subjects: [subject],
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        subject,
        contextLabel: "investor_private",
        sensitivity: "CONFIDENTIAL",
        layer: "STRUCTURED_STATE",
        factCategories: ["INVESTOR_THESIS"],
        projection: "FULL",
        rights: {
          canUseForReasoning: true,
          canDiscloseExistence: true,
          canQuote: true,
          canProvideLink: false,
        },
        filter: { tenantId: TENANT, investorOrganisationId: ORG },
        isEvidence: true,
      },
    ],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

type Replay = {
  readonly traced: readonly Trace[];
  readonly classifications: readonly string[];
  readonly prompts: readonly {
    chars: number;
    text: string;
  }[];
  readonly routing: QRunRouting | undefined;
  readonly stored: readonly string[];
  readonly firstText: string | null;
  readonly completeMs: number;
  readonly tools: readonly string[];
  readonly retrievals: number;
};

async function replay(
  said: string,
  reading: Record<string, unknown>,
  earlier: (conversationId: string) => QConversationMessage[],
): Promise<Replay> {
  const started = Date.now();
  const at = (): number => Date.now() - started;
  const traced: Trace[] = [];
  const trace = (what: string): void => {
    traced.push({ what, ms: at() });
  };
  const classifications: string[] = [];
  const prompts: { chars: number; text: string }[] = [];
  const tools: string[] = [];
  let retrievals = 0;
  const routings: QRunRouting[] = [];
  const stored: QConversationMessage[] = [];
  let firstText: string | null = null;
  const conversationId = randomUUID();
  const runId = randomUUID();
  const history = earlier(conversationId);
  const latest = {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId,
    runId,
    role: "USER",
    content: said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  } as unknown as QConversationMessage;
  const repositories = {
    messages: {
      listForRun: async () => {
        await wait(LATENCY.dbMs);
        return [...history, latest, ...stored];
      },
      listRecentForConversationOfRun: async () => {
        await wait(LATENCY.dbMs);
        return [...history, latest, ...stored];
      },
      insert: async (
        _tx: unknown,
        row: Omit<QConversationMessage, "id" | "createdAt">,
      ) => {
        await wait(LATENCY.dbMs);
        const message = {
          ...row,
          id: (row as { id?: string }).id ?? randomUUID(),
          createdAt: new Date().toISOString(),
        } as unknown as QConversationMessage;
        stored.push(message);
        return message;
      },
      mark: () => Promise.resolve(),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: {
      append: async (
        _tx: unknown,
        input: { eventType?: string; visibleStage?: string | null },
      ) => {
        await wait(LATENCY.dbMs);
        if (input.eventType !== undefined) trace(input.eventType);
        if (input.visibleStage !== null && input.visibleStage !== undefined) {
          trace(`stage ${input.visibleStage}`);
        }
        return {};
      },
    },
  } as unknown as QRuntimeRepositories;
  const deltas = {
    publish: (delta: QLiveDelta) => {
      if (delta.holding === true) {
        trace("holding");
        return;
      }
      if (delta.text.trim().length > 0) {
        firstText ??= delta.text;
        trace("q.message.delta");
      }
    },
    subscribe: () => () => undefined,
    subscriberCount: () => 1,
  };
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog()),
    registry: createModelProviderRegistry([answerModel(trace, prompts)]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const debug = process.env["CQ_TURN_TIMING_DEBUG"] === "1";
  const print =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      if (debug) console.log(level, at(), message, JSON.stringify(fields));
    };
  const logger = {
    debug: () => undefined,
    info: print("info"),
    warn: print("warn"),
    error: print("error"),
    child: () => logger,
  };
  const toolPort: QToolPort = {
    offer: async () => {
      await wait(LATENCY.dbMs);
      return READ_TOOLS.map(([name, tool]) => offered(name, tool));
    },
    execute: async (proposal) => {
      tools.push(proposal.name);
      await wait(LATENCY.dbMs);
      return {
        callId: proposal.callId,
        toolName: proposal.name,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "PUBLIC",
        result: { ok: true, data: { items: [] } },
        latencyMs: LATENCY.dbMs,
      };
    },
  };
  const arrivalSkim: QTurnSkimmer = {
    skim: async () => {
      classifications.push("arrival-skim");
      trace("arrival skim asked");
      await wait(LATENCY.arrivalSkimMs);
      trace("arrival skim done");
      return { kind: "OTHER", confidence: "HIGH" } as never;
    },
  };
  const delegate = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: toolPort,
    deltas,
    logger,
    accountDigestOf: async () => {
      await wait(LATENCY.dbMs);
      return QAccountDigestSchema.parse({
        side: "INVESTOR",
        relationships: [],
        relationshipsTotal: 0,
        byStage: {},
        relationshipCounterpartIds: [],
        waiting: [],
        waitingTotal: 0,
        meetings: [],
        work: [],
        requests: [],
        gateq: null,
        recent: [],
        unread: [],
        readAt: new Date().toISOString(),
      });
    },
    arrivalSnapshot: async () => {
      await wait(LATENCY.dbMs);
      return SNAPSHOT;
    },
    arrivalSkim,
    // Production composes the conversational answer with the parallel
    // extras writer on (CQ_Q_PARALLEL_EXTRAS); a one-call lane never uses it.
    parallelExtras: true,
    // Their documents and Q's knowledge, as the evidence port assembles
    // them: three passages a card explanation does not need.
    context: {
      assemble: async () => {
        retrievals += 1;
        await wait(LATENCY.retrievalMs);
        return {
          facts: Array.from({ length: 3 }, (_, index) => ({
            scope: "DOCUMENTS" as const,
            statement: `Passage ${String(index + 1)} of their own mandate memo: ${"sector focus and cheque size ".repeat(30)}`,
            truthClass: "USER_CLAIM" as const,
            evidenceStatus: "DOCUMENT_SUPPORTED" as const,
            source: "Mandate memo",
          })),
          subjectDescription: "their own documents, three passages",
        };
      },
    },
  });
  const turns: QTurnReader = {
    read: async () => {
      classifications.push("reader");
      trace("reader asked");
      await wait(LATENCY.readerMs);
      trace("reader done");
      return reading as never;
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: async () => {
      classifications.push("skim");
      trace("skim asked");
      await wait(LATENCY.skimMs);
      trace("skim done");
      return { kind: "OTHER", confidence: "HIGH", subject: null } as never;
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate,
    deltas,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    turnSkim,
    logger,
    recordRouting: ({ routing }) => {
      routings.push(routing);
      return Promise.resolve();
    },
  });
  const request = {
    runId,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${runId}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(runId),
  } as unknown as QAnswerRequest;
  answer.preread?.({
    runId: request.runId,
    tenantId: request.tenantId,
    actor: request.actor,
    correlationId: request.correlationId,
  });
  const outcome = await answer.answer(request);
  const completeMs = at();
  expect(outcome.kind).toBe("ANSWERED");
  if (debug) {
    console.log(traced.map((t) => `${t.what}@${String(t.ms)}`).join("\n"));
    for (const prompt of prompts) console.log("prompt chars", prompt.chars);
  }
  return {
    traced,
    classifications,
    prompts,
    routing: routings[0],
    stored: stored.map((message) => message.content),
    firstText,
    completeMs,
    tools,
    retrievals,
  };
}

/** Runs `work` on the virtual clock (as turn-timing.test.ts does). */
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

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
  blocks?: unknown,
): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId,
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  } as unknown as QConversationMessage;
}

function cards(
  title: string,
  list: readonly { readonly name: string; readonly id: string }[],
  score: number,
) {
  return [
    {
      kind: "ANSWER_CARDS",
      title,
      shape: "RANKED",
      cards: list.map((card, at) => ({
        key: `c${String(at)}`,
        name: card.name,
        line: null,
        hue: 0,
        fit: { score, measured: 9, of: 9 },
        reasons: [],
        measures: [],
        subject: { kind: "COMPANY", companyId: card.id },
      })),
      followUps: [],
    },
  ];
}

/** The live conversation: the revenue list, then the widened one-card list. */
const conversation = (conversationId: string): QConversationMessage[] => [
  message(
    conversationId,
    "USER",
    "Which companies that match my mandate already make money?",
  ),
  message(
    conversationId,
    "Q",
    "Of the ten companies closest to your mandate that I checked, four have revenue on record. Ranked by fit with your mandate: MedTrail at 9.2, Mizan at 9.2, Kesho at 9.2 and Nafasi at 9.2.",
    cards(
      "Fit against your mandate: revenue on record",
      [
        { name: "MedTrail", id: MEDTRAIL },
        { name: "Mizan", id: MIZAN },
        { name: "Kesho", id: KESHO },
        { name: "Nafasi", id: NAFASI },
      ],
      9.2,
    ),
  ),
  message(
    conversationId,
    "USER",
    "Narrow that to the weakest ones beyond my sectors",
  ),
  message(
    conversationId,
    "Q",
    "None of the ten companies I just showed are outside your preferred sectors, so I looked wider. Of the 45 companies on Capital Q I checked, one has revenue on record and is outside your preferred sectors. The weakest fits against your mandate, weakest first: Baridi at 6.2.",
    cards(
      "Weakest fits against your mandate: revenue on record and outside your preferred sectors",
      [{ name: "Baridi", id: BARIDI }],
      6.2,
    ),
  ),
];

const reading = (
  text: string,
  question: string,
  rest: Record<string, unknown>,
): Record<string, unknown> => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: question, text },
  aboutNamedOther: false,
  namedOther: null,
  reference: null,
  navigation: { mode: "CONTEXT", negated: false, destination: "DISCOVER" },
  ...rest,
});

const first = (traced: readonly Trace[], what: string): number =>
  traced.find((one) => one.what === what)?.ms ?? Number.POSITIVE_INFINITY;

describe("live re-check 6f9b63cc5: a shown-list explanation is fast and streamed", () => {
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

  const turns: readonly (readonly [string, string, Record<string, unknown>])[] =
    [
      [
        "run 1, as observed",
        "How come it made the list?",
        reading("How come it made the list?", "ADVICE", {
          aboutNamedOther: true,
        }),
      ],
      [
        "run 2, as observed",
        "What put the second one in the first list above the rest?",
        reading(
          "What put the second one in the first list above the rest?",
          "THEIR_OWN_RECORDS",
          {
            // The reader binds "the second one in the first list" (live:
            // Mizan, tied at 9.2 with three others).
            reference: {
              open: "COMPANY",
              name: "Mizan",
              shown: 2,
              retryLast: false,
              sameFor: null,
            },
          },
        ),
      ],
    ];

  for (const [how, said, read] of turns) {
    it(`${how}: "${said}" -- streamed first, answer asked on the reading, no third classification`, async () => {
      // Load and compile once, untimed.
      await onVirtualClock(() => replay(said, read, conversation));
      const run = await onVirtualClock(() => replay(said, read, conversation));
      const { traced } = run;
      // The routing is unchanged: the card, in place, no web.
      expect(run.routing).toMatchObject({
        executionClass: "CONTEXTUAL_FOLLOW_UP",
        research: "NEVER",
        navigation: "NONE",
        navigationGuard: "SHOWN_LIST_EXPLANATION",
      });
      expect(run.tools).toEqual([]);
      // (a) Only the reader (and the specialist's skim, when it runs)
      // read the turn: no arrival skim for a turn bound to Q's own card.
      expect(run.classifications).toContain("reader");
      expect(
        run.classifications.filter((one) => one !== "reader" && one !== "skim"),
      ).toEqual([]);
      // (b) The answer model is asked as the reading lands.
      const readerDone = first(traced, "reader done");
      const asked = first(traced, "model asked");
      expect(asked - readerDone).toBeLessThanOrEqual(300);
      // (c) The answer streams: its words go out before its findings and
      // before the message completes.
      const delta = first(traced, "q.message.delta");
      expect(delta).toBeLessThan(first(traced, "q.finding.available"));
      expect(delta).toBeLessThan(first(traced, "q.message.completed"));
      // (d) One answer call; its prompt carries the card and its list (the
      // title as conditions, the words as order) and the question, not
      // their documents, and their documents are not searched again once
      // the turn is read.
      expect(run.prompts).toHaveLength(1);
      const prompt = run.prompts[0]?.text ?? "";
      expect(prompt).toContain("listAsSaid");
      expect(prompt).not.toContain("of their own mandate memo");
      expect(run.retrievals).toBe(1);
      // Phase 3 targets.
      expect(delta).toBeLessThanOrEqual(3_500);
      expect(first(traced, "q.message.completed")).toBeLessThanOrEqual(6_000);
      // The answer the person reads is the model's, unchanged.
      expect(run.stored.at(-1)).toContain("Baridi made the list");
    });
  }

  it("a why about someone on their arrival, after a list, still reads it as an arrival follow-up and searches their documents again", async () => {
    const said = "Why is TensorGate still waiting?";
    const read = reading(said, "THEIR_OWN_RECORDS", {
      aboutNamedOther: true,
      namedOther: { kind: "INVESTOR", name: "TensorGate" },
      navigation: { mode: "NONE", negated: false, destination: null },
    });
    await onVirtualClock(() => replay(said, read, conversation));
    const run = await onVirtualClock(() => replay(said, read, conversation));
    expect(run.routing?.navigationGuard ?? null).toBeNull();
    expect(run.routing?.executionClass).not.toBe("CONTEXTUAL_FOLLOW_UP");
    expect(run.classifications).toContain("arrival-skim");
    expect(run.retrievals).toBe(2);
  });
});
