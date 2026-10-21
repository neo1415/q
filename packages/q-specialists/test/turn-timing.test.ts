import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
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
  QToolCallOutcome,
  QToolPort,
  QToolProposal,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Turn timing harness (owner 2026-10-21: as fast as it can be done
 * properly; waste removed, nothing that does real work cut, and each
 * step's stage visible as it starts). The table it prints is the evidence
 * of a speed-up, not a pass mark.
 *
 * The real answer path end to end -- the specialist seam (`answer.ts`),
 * the conversational gateway answer and its tool loop (`model-gateway`
 * `q/index.ts`), the real model gateway with its routing -- with only the
 * providers replaced: models, the turn reader and skim, tools and the
 * public web reply after the latencies below. Times are scaled by
 * `CQ_TURN_TIMING_SCALE` (default 0.05, so the suite stays fast) and
 * reported back in real milliseconds.
 *
 * Latencies and their sources (docs/ai-handoff/workstreams/
 * TURN-LATENCY-2026-10-20.md section 1 unless stated):
 *   TURN_SKIM 850 ms        measured p50 0.75-0.95 s (row 3)
 *   TURN_READER 1,200 ms    measured p50 1.2 s (row 4)
 *   tool-selection round    1,900 ms (row 16: two rounds 3.8-4.5 s;
 *                           PERFORMANCE-BASELINE.md: 1,798 + 2,036 ms)
 *   answer model            700 ms to first token (assumed, not
 *                           measured), then 100 tokens/s (row 15:
 *                           ~100 tokens/s, 1,100-2,280 tokens out)
 *   public web search       3,000 ms (model-gateway: "three seconds on
 *                           the web")
 *   a tool read             40 ms (row 7: 20-80 ms)
 *   a database write/read   10 ms
 */

const SCALE = Number(process.env["CQ_TURN_TIMING_SCALE"] ?? "0.05");
const LATENCY = {
  skimMs: 850,
  readerMs: 1_200,
  roundMs: 1_900,
  firstTokenMs: 700,
  tokensPerSecond: 100,
  webMs: 3_000,
  readMs: 40,
  dbMs: 10,
} as const;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms * SCALE));

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const COMPANIES: Readonly<Record<string, string>> = {
  "Northwind Ledger": "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
  "Halyard Health": "6ed1da85-cddc-4015-b5c2-86a95a48cfc8",
};

function catalog(): ModelCatalogSnapshot {
  const provider = "b1000000-0000-4000-8000-000000000001";
  const model = "b2000000-0000-4000-8000-000000000001";
  const policy = (index: number, taskClass: string) => ({
    id: `b400000${String(index)}-0000-4000-8000-000000000001`,
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
  });
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
    ].map((taskClass, index) => policy(index + 1, taskClass)),
    loadedAt: "2026-10-21T00:00:00.000Z",
  });
}

/** What a journey needs read before a careful model would answer. */
type Needs = {
  readonly companies: readonly string[];
  readonly web: boolean;
  readonly cards: boolean;
};

/** A model that asks for what it needs, all at once, then answers. */
function timedModel(
  needs: Needs,
  answerTokens: number,
  /** The answer text's share of the object (scripts/handoff/answer-output-split.mjs). */
  answerShare: number,
  calls: string[],
  trace?: (what: string) => void,
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
      const seen = JSON.stringify(request.messages);
      const offered = new Set(request.tools.map((tool) => tool.name));
      const proposals: { name: string; arguments: Record<string, unknown> }[] =
        [];
      for (const name of needs.companies) {
        const id = COMPANIES[name] ?? "";
        if (seen.includes(`profile of ${name}`)) continue;
        if (seen.includes(id) && offered.has("get_company")) {
          proposals.push({ name: "get_company", arguments: { companyId: id } });
        } else if (offered.has("search_companies")) {
          proposals.push({
            name: "search_companies",
            arguments: { query: name },
          });
        }
      }
      if (
        needs.web &&
        !seen.includes("public page about") &&
        offered.has("research_public_web")
      ) {
        proposals.push({
          name: "research_public_web",
          arguments: { query: needs.companies[0] ?? "news" },
        });
      }
      if (
        needs.cards &&
        !seen.includes("slate of companies") &&
        offered.has("discovery_slate")
      ) {
        proposals.push({ name: "discovery_slate", arguments: {} });
      }
      if (proposals.length > 0) {
        calls.push(`tools:${proposals.map((p) => p.name).join("+")}`);
        await wait(LATENCY.roundMs);
        return {
          text: "",
          toolCalls: proposals.map((p, index) => ({
            callId: `c${String(calls.length)}-${String(index)}`,
            name: p.name,
            arguments: p.arguments,
          })),
          usage: undefined,
          finish: "TOOL_CALLS",
          modelCode: request.modelCode,
          providerReference: undefined,
        };
      }
      calls.push(`answer:${String(answerTokens)}`);
      // About four characters a token: the answer is most of the object.
      const sentence =
        "Northwind Ledger declares a seed stage and steady revenue growth. ";
      const answer = sentence
        .repeat(Math.max(1, Math.round((answerTokens * 4 * answerShare) / 66)))
        .trim();
      const value = {
        answer,
        responseShape: "ANALYTICAL",
        findings: [
          {
            statement: "x".repeat(
              Math.round(answerTokens * 4 * (1 - answerShare)),
            ),
            truthClass: "USER_CLAIM",
          },
        ],
        missingEvidence: [],
        contradictions: [],
        insufficientEvidence: false,
        recommendation: null,
        clarifyingQuestions: [],
        declined: false,
      };
      const json = JSON.stringify(value);
      trace?.("model asked");
      await wait(LATENCY.firstTokenMs);
      trace?.("first token");
      const piece = 80;
      const perPieceMs = (piece / 4 / LATENCY.tokensPerSecond) * 1_000;
      for (let at = 0; at < json.length; at += piece) {
        context.onTextDelta?.(json.slice(at, at + piece));
        await wait(perPieceMs);
      }
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

const TOOL_NAMES: Readonly<Record<string, string>> = {
  search_companies: "company.search",
  get_company: "company.get",
  research_public_web: "research.public_web",
  discovery_slate: "discovery.slate",
};

const tool = (
  name: string,
  stage: QOfferedTool["visibleStage"],
): QOfferedTool => ({
  toolName: TOOL_NAMES[name] ?? name,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: stage,
});

const TOOLS: readonly QOfferedTool[] = [
  tool("search_companies", "REVIEWING_COMPANY"),
  tool("get_company", "REVIEWING_COMPANY"),
  tool("research_public_web", "SEARCHING_PUBLIC_SOURCES"),
  tool("discovery_slate", "COMPARING_OPPORTUNITIES"),
];

function toolPort(onRead?: (what: string) => void): QToolPort {
  const outcome = (
    proposal: QToolProposal,
    data: unknown,
  ): QToolCallOutcome => ({
    callId: proposal.callId,
    toolName: TOOL_NAMES[proposal.name] ?? proposal.name,
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "PUBLIC",
    result: { ok: true, data },
    latencyMs: LATENCY.readMs,
  });
  return {
    offer: () => Promise.resolve([...TOOLS]),
    execute: async (proposal) => {
      const args = proposal.arguments as Record<string, unknown>;
      onRead?.(`${proposal.name}:${proposal.callId}`);
      if (proposal.name === "research_public_web") {
        await wait(LATENCY.webMs);
        return outcome(proposal, {
          sources: [{ title: "public page about Northwind Ledger" }],
        });
      }
      await wait(LATENCY.readMs);
      if (proposal.name === "search_companies") {
        // Case-insensitive, as the real search is.
        const query = String(args["query"]).toLowerCase();
        const name =
          Object.keys(COMPANIES).find((key) => key.toLowerCase() === query) ??
          String(args["query"]);
        return outcome(proposal, {
          items: [{ companyId: COMPANIES[name], canonicalName: name }],
        });
      }
      if (proposal.name === "get_company") {
        const name =
          Object.entries(COMPANIES).find(
            ([, id]) => id === args["companyId"],
          )?.[0] ?? "";
        // The shape get_company returns (GetCompanyOutputSchema).
        return outcome(proposal, {
          companyId: args["companyId"],
          canonicalName: name,
          legalName: null,
          websiteUrl: null,
          foundedDate: "2021-03-01",
          headquartersCountry: "KE",
          headquartersCity: "Nairobi",
          currentStageCode: "seed",
          shortDescription: `profile of ${name}`,
          primaryDescription: null,
          companyStatus: "active",
          relationToYou: "SHARED",
          truthClass: "USER_CLAIM",
        });
      }
      return outcome(proposal, {
        items: [{ title: "slate of companies" }],
      });
    },
  };
}

type Journey = {
  readonly name: string;
  readonly said: string;
  readonly spoken: boolean;
  readonly needs: Needs;
  /** Output tokens of the answer object, as measured (row 15). */
  readonly answerTokens: number;
  /**
   * The answer text's share of those tokens, estimated by
   * scripts/handoff/answer-output-split.mjs (o200k_base, representative
   * objects): typed 29%, comparison 21%, spoken 14%; a written document is
   * nearly all text. The answer streams first; findings, cards and the
   * rest follow it.
   */
  readonly answerShare: number;
  readonly reading: Record<string, unknown>;
  /** What the early skim says (production: FIT for a fit ask). */
  readonly skim?: string;
  /** Q's earlier reply in this conversation, for a follow-up. */
  readonly before?: string;
  /** "Make me a PDF": exempt from the budget, its stages timed. */
  readonly document?: boolean;
};

export type Timing = {
  readonly journey: string;
  readonly firstVisibleMs: number | null;
  readonly firstWordsMs: number | null;
  readonly lastWordsMs: number | null;
  readonly completeMs: number;
  readonly modelCalls: number;
  readonly calls: readonly string[];
  readonly stages: readonly string[];
};

const question = (kind: string, text: string) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind, text },
  aboutNamedOther: true,
  fromShown: null,
});

export const JOURNEYS: readonly Journey[] = [
  {
    name: "typed question about one company",
    said: "What are the risks with Northwind Ledger?",
    spoken: false,
    needs: { companies: ["Northwind Ledger"], web: false, cards: false },
    answerTokens: 1_100,
    answerShare: 0.29,
    reading: question("ANALYSIS", "What are the risks with Northwind Ledger?"),
  },
  {
    // Typed in lowercase, so code does not take it for a name: the model
    // searches, and the profile is read after (row 16 chained read).
    name: "typed question, company named in lowercase",
    said: "what are the risks with northwind ledger?",
    spoken: false,
    needs: { companies: ["Northwind Ledger"], web: false, cards: false },
    answerTokens: 1_100,
    answerShare: 0.29,
    reading: question("ANALYSIS", "what are the risks with northwind ledger?"),
  },
  {
    name: "comparison of two companies",
    said: "Compare Northwind Ledger and Halyard Health",
    spoken: false,
    needs: {
      companies: ["Northwind Ledger", "Halyard Health"],
      web: false,
      cards: false,
    },
    answerTokens: 2_280,
    answerShare: 0.21,
    reading: question(
      "COMPARISON",
      "Compare Northwind Ledger and Halyard Health",
    ),
  },
  {
    name: "public web search by name",
    said: "What is the latest public news on Northwind Ledger?",
    spoken: false,
    needs: { companies: [], web: true, cards: false },
    answerTokens: 900,
    answerShare: 0.29,
    reading: {
      ...question("FACTUAL", "latest public news on Northwind Ledger"),
      kind: "RESEARCH_REQUEST",
    },
  },
  {
    name: "spoken follow-up",
    said: "why does that matter for a seed investor",
    spoken: true,
    needs: { companies: [], web: false, cards: false },
    answerTokens: 250,
    answerShare: 0.14,
    reading: {
      ...question("ANALYSIS", "why does that matter for a seed investor"),
      aboutNamedOther: false,
    },
    before: "Northwind Ledger declares a seed stage and steady revenue growth.",
  },
  {
    name: "voice answer with cards",
    said: "show me the companies that fit my mandate best",
    spoken: true,
    needs: { companies: [], web: false, cards: true },
    answerTokens: 350,
    answerShare: 0.14,
    reading: {
      ...question("FIT", "show me the companies that fit my mandate best"),
      aboutNamedOther: false,
    },
    skim: "FIT",
  },
  {
    name: "make me a PDF (exempt; stages timed)",
    said: "Write me a short report on Northwind Ledger as a PDF",
    spoken: false,
    needs: { companies: ["Northwind Ledger"], web: false, cards: false },
    answerTokens: 2_000,
    answerShare: 0.9,
    reading: {
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: true,
      tool: {
        kind: "PREPARE_DOCUMENT",
        destination: null,
        unknownScreen: null,
        visibility: null,
        documentType: "Q_REPORT",
        subjectName: "Northwind Ledger",
      },
      fromShown: null,
    },
    document: true,
  },
];

export async function timeJourney(journey: Journey): Promise<Timing> {
  const runId = randomUUID();
  const conversationId = randomUUID();
  const calls: string[] = [];
  const started = performance.now();
  const at = (): number => (performance.now() - started) / SCALE;
  let firstVisibleMs: number | null = null;
  let firstWordsMs: number | null = null;
  /** The last streamed sentence: the voice has the whole answer to say. */
  let lastWordsMs: number | null = null;
  const stages: string[] = [];
  const traced: string[] = [];
  const trace = (what: string): void => {
    traced.push(`${what}@${String(Math.round(at()))}`);
  };
  const stored: QConversationMessage[] = [];
  const earlier: QConversationMessage[] =
    journey.before === undefined
      ? []
      : [
          {
            id: randomUUID(),
            tenantId: TENANT,
            conversationId,
            runId: randomUUID(),
            role: "Q",
            content: journey.before,
            contentType: "TEXT",
            createdAt: new Date(Date.now() - 30_000).toISOString(),
          } as unknown as QConversationMessage,
        ];
  const latest = {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId,
    runId,
    role: "USER",
    content: journey.said,
    contentType: "TEXT",
    ...(journey.spoken ? { utteranceRef: `utt_${runId}` } : {}),
    createdAt: new Date().toISOString(),
  } as unknown as QConversationMessage;
  const repositories = {
    messages: {
      listForRun: async () => {
        await wait(LATENCY.dbMs);
        return [...earlier, latest, ...stored];
      },
      listRecentForConversationOfRun: async () => {
        await wait(LATENCY.dbMs);
        return [...earlier, latest, ...stored];
      },
      insert: async (
        _tx: unknown,
        row: Omit<QConversationMessage, "id" | "createdAt">,
      ) => {
        await wait(LATENCY.dbMs);
        firstWordsMs ??= at();
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
        if (input.visibleStage !== null && input.visibleStage !== undefined) {
          stages.push(`${input.visibleStage}@${String(Math.round(at()))}`);
          firstVisibleMs ??= at();
        }
        return {};
      },
    },
  } as unknown as QRuntimeRepositories;
  const deltas = {
    publish: (delta: QLiveDelta) => {
      if (delta.preview !== undefined) firstVisibleMs ??= at();
      if (delta.text.trim().length > 0) {
        lastWordsMs = at();
        if (firstWordsMs === null) trace("first words");
        firstWordsMs ??= at();
        firstVisibleMs ??= at();
      }
    },
    subscribe: () => () => undefined,
    subscriberCount: () => 1,
  };
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(catalog()),
    registry: createModelProviderRegistry([
      timedModel(
        journey.needs,
        journey.answerTokens,
        journey.answerShare,
        calls,
        trace,
      ),
    ]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const debug = process.env["CQ_TURN_TIMING_DEBUG"] === "1";
  const print =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      if (debug) console.log(level, message, JSON.stringify(fields));
    };
  const silent = {
    debug: () => undefined,
    info: print("info"),
    warn: print("warn"),
    error: print("error"),
    child: () => silent,
  };
  const delegate = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: toolPort(trace),
    deltas,
    logger: silent,
  });
  const turns: QTurnReader = {
    read: async () => {
      calls.push("reader");
      trace("reader asked");
      await wait(LATENCY.readerMs);
      trace("reader done");
      return journey.reading as never;
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: async () => {
      calls.push("skim");
      await wait(LATENCY.skimMs);
      return { kind: journey.skim ?? "OTHER", confidence: "HIGH" } as never;
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
    logger: silent,
    ...(journey.document === true
      ? {
          artifacts: {
            port: {
              // Filing and rendering the PDF: 2,500 ms assumed (not
              // measured on this branch).
              prepare: async () => {
                trace("pdf filing");
                await wait(2_500);
                trace("pdf filed");
                return {
                  artifactId: randomUUID(),
                  type: "Q_REPORT",
                  status: "READY",
                  title: "Northwind Ledger",
                };
              },
            },
            reviser: {},
          } as never,
        }
      : {}),
    ...(journey.spoken
      ? { speculation: { spoken: true, observe: () => undefined } }
      : {}),
  });
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
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
  const request = {
    runId,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${runId}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan,
  } as unknown as QAnswerRequest;
  answer.preread?.({
    runId: request.runId,
    tenantId: request.tenantId,
    actor: request.actor,
    correlationId: request.correlationId,
  });
  const outcome = await answer.answer(request);
  // A document is filed after its answer; the turn is complete when the
  // card's reply is stored.
  const completeMs = at();
  expect(outcome.kind).toBe("ANSWERED");
  return {
    journey: journey.name,
    firstVisibleMs,
    firstWordsMs,
    lastWordsMs,
    completeMs,
    modelCalls: calls.length,
    calls,
    stages: [...stages, ...traced],
  };
}

const ms = (value: number | null): string =>
  value === null ? "-" : String(Math.round(value));

describe("turn timing harness", () => {
  it("times each journey through the real answer path", async () => {
    // One pass untimed first: loading and compiling the code on first use
    // is not a turn's latency, and the time scale would magnify it.
    for (const journey of JOURNEYS) await timeJourney(journey);
    const rows: Timing[] = [];
    for (const journey of JOURNEYS) rows.push(await timeJourney(journey));
    const table = [
      "| journey | first visible | first words | answer words all out | complete | model calls | calls |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows.map(
        (row) =>
          `| ${row.journey} | ${ms(row.firstVisibleMs)} | ${ms(row.firstWordsMs)} | ${ms(row.lastWordsMs)} | ${ms(row.completeMs)} | ${String(row.modelCalls)} | ${row.calls.join(", ")} |`,
      ),
    ].join("\n");
    console.log(`\n${table}\n`);
    for (const row of rows) console.log(row.journey, row.stages.join(" "));
    expect(rows).toHaveLength(JOURNEYS.length);
    const row = (name: string): Timing => {
      const found = rows.find((one) => one.journey.startsWith(name));
      if (found === undefined) throw new Error(`no journey ${name}`);
      return found;
    };
    // Visible stages: a turn that names a company shows it being read
    // while the turn is still being read (before: after the reading, 2.2 s).
    for (const name of ["typed question about", "comparison", "public web"]) {
      expect(row(name).firstVisibleMs ?? Infinity).toBeLessThan(1_000);
    }
    // Every journey shows its steps, and the model's work has a stage.
    for (const one of rows) {
      expect(one.stages.some((stage) => /^[A-Z_]+@/u.test(stage))).toBe(true);
    }
    // Round 5: a company typed in lowercase is read by code, as a
    // capitalised one is: no lookup round at all (before: two, then one).
    expect(row("typed question, company named").calls).toEqual([
      "skim",
      "reader",
      "answer:1100",
    ]);
  }, 600_000);
});
