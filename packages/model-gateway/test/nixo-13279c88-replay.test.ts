import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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
} from "../src/index.js";
import {
  correctDocumentDenials,
  supersededByDocuments,
} from "../src/q/document-stated-figures.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 17 Nov 2026, 11:17 UTC, production be260a584 (which carried the
 * first Nixo fix, a29364f02), run 13279c88: investor Savanna Seed Partners
 * (fictional) asked "How much is Nixo burning a month and how long is its
 * runway?" (THEIR_OWN_RECORDS, MULTI_SOURCE, parallel extras). Code
 * pre-read page 1 of Nixo's KPI pack and of its management accounts (both
 * state October 2026 net burn 125,800 and runway 8.8 months); the
 * figures-limit fact named them (the first fix held). The extras call's
 * finding said the figures, with both documents cited; the answer call,
 * from the same messages, wrote "Nixo's monthly burn and runway aren't
 * established by the authorised figures I have for this question. The
 * available Nixo profile does not state either figure, so I can't give
 * you a reliable monthly burn or runway." -- and nothing in code checked
 * a sentence that says a figure is unknown against the pages it read.
 *
 * Replayed with that run's stored tool results
 * (live-replays/nixo-13279c88.json), its recalled summary and its two
 * model outputs. No provider, no network.
 */

type Stored = {
  readonly figures: unknown;
  readonly company: unknown;
  readonly dataRoom: unknown;
  readonly deck: unknown;
  readonly relationship: unknown;
  readonly kpiPack: { readonly documentId: string; readonly title: string };
  readonly managementAccounts: {
    readonly documentId: string;
    readonly title: string;
  };
};
const STORED = JSON.parse(
  readFileSync(
    new URL("./live-replays/nixo-13279c88.json", import.meta.url),
    "utf8",
  ),
) as Stored;

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const SAVANNA = "1c4b9266-350c-409d-9582-04a0f771b8a8";
const NIXO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";
const QUESTION = "How much is Nixo burning a month and how long is its runway?";
const GREETING =
  "Welcome back, Amara. Worth a look. 8 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";
const LIVE_ANSWER =
  "Nixo’s monthly burn and runway aren’t established by the authorised figures I have for this question. The available Nixo profile does not state either figure, so I can’t give you a reliable monthly burn or runway.";
const LIVE_FINDING =
  "Nixo’s management accounts for May 2025 to October 2026 report net burn of $125,800 for October 2026 and runway of 8.8 months at that burn; the KPI and product metrics pack for May 2025 to October 2026 reports the same figures.";
/**
 * Recall's rendering: the summary this run recalled (revision 1 of
 * conversation db74c76d, shortened), and -- not recalled by this run, but
 * the case the 10:07 smoke answer would make once recalled -- Q's own
 * earlier "not established" reply.
 */
const MEMORY = [
  "Earlier conversations about what they asked (what was discussed, not verified evidence):",
  "- 2026-11-16 Compare Halyard, Tensorgate and Nixo: Amara asked to compare Halyard Security, Tensorgate and Nixo. Nixo remains least evidenced commercially.",
  "",
  'Their own earlier conversations, word for word (what was said, not verified evidence; "they said" lines are their own words, "Q said" lines are Q\'s):',
  '- 2026-11-17 (in "Nixo"), Q said: "Nixo\'s monthly burn and runway aren\'t established in what I can see."',
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
  offered("list_my_relationships", "relationship.own.list"),
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("read_company_deck", "company.deck.read"),
  offered("get_relationship", "relationship.get"),
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
      case "list_my_relationships":
        return {
          relationships: [
            {
              state: "IN_DILIGENCE",
              counterpart: { id: NIXO, kind: "COMPANY", name: "Nixo" },
            },
          ],
        };
      case "search_companies":
        return {
          items: [{ companyId: NIXO, canonicalName: "Nixo" }],
          nextCursor: null,
        };
      case "get_company":
        return STORED.company;
      case "read_company_figures":
        return STORED.figures;
      case "read_company_deck":
        return STORED.deck;
      case "get_relationship":
        return STORED.relationship;
      case "read_company_data_room":
        return STORED.dataRoom;
      case "read_document_pages":
        return args["documentId"] === STORED.kpiPack.documentId
          ? STORED.kpiPack
          : args["documentId"] === STORED.managementAccounts.documentId
            ? STORED.managementAccounts
            : { status: "NOT_FOUND" };
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
          investorOrganisationId: SAVANNA,
        },
      },
    ],
  } as unknown as PermittedContextPlan;
}

type Logged = { readonly msg: string; readonly fields: unknown };

function recordingLogger(into: Logged[]): Logger {
  const at =
    () =>
    (fields: unknown, msg?: string): void => {
      into.push({ msg: msg ?? "", fields });
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

async function live(spoken?: string) {
  const fake = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value:
          spoken === undefined
            ? analyst(LIVE_ANSWER)
            : { ...analyst(LIVE_ANSWER), spoken },
      },
      {
        kind: "JSON",
        value: {
          ...analyst("."),
          findings: [
            {
              type: "FACT",
              statement: LIVE_FINDING,
              truthClass: "USER_CLAIM",
              evidenceStatus: "DOCUMENT_SUPPORTED",
              confidence: "HIGH",
              basis: ["F1"],
            },
          ],
        },
      },
    ],
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
  const started = Date.parse("2026-11-17T11:17:02.000Z");
  const messages: QConversationMessage[] = (
    [
      { role: "Q", content: GREETING },
      { role: "USER", content: QUESTION },
    ] as const
  ).map(
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
    namedOther: { kind: "COMPANY", name: "Nixo" },
    research: Promise.resolve({ mode: "NEVER", announceSourceChange: false }),
    executionClass: "MULTI_SOURCE",
  } as unknown as QAnswerRequest;
  seam.warm?.(request);
  const outcome = await seam.answer(request);
  const completed = events
    .filter((event) => event.type === "q.message.completed")
    .map(
      (event) =>
        event.payload as {
          message: { text: string; spoken?: { text: string } };
        },
    )
    .at(-1);
  const deltas = events
    .filter((event) => event.type === "q.message.delta")
    .map((event) => JSON.stringify(event.payload))
    .join("\n");
  const sent = fake.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");
  return {
    outcome,
    said: completed?.message.text ?? "",
    spokenForm: completed?.message.spoken?.text ?? null,
    deltas,
    sent,
    logged,
  };
}

const DENIAL = /aren['’]t established|does not state either figure/u;

describe("live 13279c88 on be260a584: Nixo's burn and runway, stated by the pages read, said to be unknown", () => {
  it("the prompt carries the pages' burn and runway, and no code-written fact calls them unknown", async () => {
    const { sent } = await live();
    expect(sent).toContain(
      "Net burn (payments less customer receipts) | 125,800",
    );
    expect(sent).toContain("Net burn USD 125,800");
    expect(sent).not.toContain(
      "What Q could read of Nixo's figures for this person is its published figures on Capital Q and the figures its pitch deck states, given as facts here.",
    );
    // The recalled "not established" is labelled as superseded by the
    // pages read this turn.
    // The first fix held: the limit fact names the documents read.
    expect(sent).toContain(
      "DATA ROOM DOCUMENT facts: answer a figure they state from them first",
    );
    expect(sent).toMatch(
      /aren't established in what I can see\.\\?"\s*\[Superseded by this turn's read of/u,
    );
  });

  it("the answer's sentences that call them unknown are said as the document states them, with title, page and period", async () => {
    const { outcome, said, deltas, logged } = await live();
    expect(outcome.kind).toBe("ANSWERED");
    expect(said).not.toMatch(DENIAL);
    expect(said).toContain("net burn of USD 125,800");
    expect(said).toContain("runway of 8.8 months");
    expect(said).toContain("Oct");
    expect(said).toMatch(
      /"(?:KPI and product metrics pack|Management accounts, May 2025 to Oct 2026)" \(p\. 1\)/u,
    );
    // Said once, not once per denying sentence.
    expect(said.match(/net burn of USD 125,800/gu)?.length).toBe(1);
    // Nor streamed.
    expect(deltas).not.toMatch(DENIAL);
    expect(
      logged.some(
        (one) =>
          one.msg ===
          "a figure the documents read this turn state was said to be unknown; said as they state it",
      ),
    ).toBe(true);
  });
});

describe("voice directive 15 Nov: the spoken form says what the checked answer says", () => {
  it("a spoken form calling burn and runway unknown is said as the document states them, its repeat not said", async () => {
    const { said, spokenForm } = await live(
      "Nixo's monthly burn and runway aren't established in what I have. The profile does not state either figure, so I can't give you a reliable runway.",
    );
    expect(said).toContain("net burn of USD 125,800");
    expect(spokenForm).not.toBeNull();
    expect(spokenForm).not.toMatch(DENIAL);
    expect(spokenForm).not.toMatch(/can['’]t give you a reliable runway/u);
    expect(spokenForm).toContain("125,800");
    expect(spokenForm).toContain("8.8 months");
  });
});

describe("the denial guard, on its own", () => {
  const ACCOUNTS = {
    title: "Management accounts, May 2025 to Oct 2026",
    text: "[p. 1] Amounts in USD, whole units.\nSummary for October 2026\nOct 2026\nRevenue | 72,000\nNet burn (payments less customer receipts) | 125,800\nRunway at this month's net burn (months) | 8.8\n",
  };

  it("leaves a sentence that already states the document's figures", () => {
    const text =
      "The profile does not state burn, but the management accounts show net burn of 125,800 and runway of 8.8 months.";
    expect(correctDocumentDenials(text, [ACCOUNTS]).text).toBe(text);
  });

  it("leaves a denial about a measure no document read states", () => {
    const text = "Nixo's payroll is not established.";
    expect(correctDocumentDenials(text, [ACCOUNTS]).text).toBe(text);
  });

  it("leaves a denial about another year than the document's", () => {
    const text = "Nixo's 2027 burn is not stated.";
    expect(correctDocumentDenials(text, [ACCOUNTS]).text).toBe(text);
  });

  it("never reads a monthly column as the figure: a row with several values states no single one", () => {
    const text = "Nixo's runway is unknown.";
    const table = {
      title: "Plan",
      text: "[p. 1] Runway (months) | 9 | 8 | 7\n",
    };
    expect(correctDocumentDenials(text, [table]).text).toBe(text);
  });

  it("corrects a denial and labels a recalled one, with title, page and period", () => {
    const corrected = correctDocumentDenials(
      "Nixo's runway is not available. It has a strong team.",
      [ACCOUNTS],
    );
    expect(corrected.corrected).toBe(1);
    expect(corrected.text).toBe(
      'The document "Management accounts, May 2025 to Oct 2026" (p. 1) states runway of 8.8 months for Oct 2026. It has a strong team.',
    );
    expect(
      supersededByDocuments('Q said: "Burn isn\'t known."', [ACCOUNTS]),
    ).toContain(
      '[Superseded by this turn\'s read of "Management accounts, May 2025 to Oct 2026" (p. 1), which states net burn of USD 125,800 for Oct 2026.]',
    );
  });
});
