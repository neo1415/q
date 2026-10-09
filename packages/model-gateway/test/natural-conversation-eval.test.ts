import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
  type QResultBlock,
} from "@capital-q/contracts";
import { naturalRegisterIssues, SPOKEN_WORDS_MAX } from "@capital-q/q-core";
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
import { fitFixture } from "./fit-fixture.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Natural-conversation eval (docs/research/2026-10-07/natural-conversation.md
 * §3.5): Zino's three questions (conversation d54a7441, 2026-10-07) and
 * the lead's live replay after the first deploy, through the real answer
 * seam with the model's live answers scripted, checked by code: first
 * person, names present, cards on every fit or list question, no "on
 * screen" without cards, one disclaimer at most, no question-back card,
 * no banned phrases, spoken length bound. How well a model talks is for
 * the probabilistic evals; this is what code guarantees.
 */

const offered = (
  toolName: string,
  name: string,
  visibleStage: QOfferedTool["visibleStage"] = null,
): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage,
});

const OWN_FIRM = "9c73b384-876c-45a9-a564-d498d1a3fe22";

const C = {
  Portside: "7b62eab6-39b9-4cb6-884a-878301f6928f",
  Souqsheet: "601a1923-fc40-4fe2-a775-d01af89f60ea",
  Baridi: "7e5a7a76-857a-4528-9641-08c7bab9cc22",
  "Maji Loop": "01c554bf-8bf1-4eb7-b460-5d841764c40b",
  Termly: "1d243b5e-fe0d-4be5-9549-cb60e28652e6",
} as const;

const FITS: Record<string, QToolCallOutcome["result"]> = {
  [C.Portside]: fitFixture(
    C.Portside,
    "Portside",
    {
      STAGE: "STRONG",
      SECTOR: "STRONG",
      BUSINESS_MODEL: "STRONG",
      GEOGRAPHY: "PARTIAL",
    },
    "GOOD_FIT",
    "Egypt",
  ).result,
  [C.Souqsheet]: fitFixture(
    C.Souqsheet,
    "Souqsheet",
    { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "STRONG" },
    "STRONG_FIT",
    "Nigeria",
  ).result,
  [C.Baridi]: fitFixture(
    C.Baridi,
    "Baridi",
    {
      STAGE: "STRONG",
      SECTOR: "STRONG",
      GEOGRAPHY: "STRONG",
      BUSINESS_MODEL: "MISMATCH",
    },
    "GOOD_FIT",
    "Kenya",
  ).result,
  [C["Maji Loop"]]: fitFixture(
    C["Maji Loop"],
    "Maji Loop",
    { STAGE: "STRONG", GEOGRAPHY: "STRONG", SECTOR: "PARTIAL" },
    "PARTIAL_FIT",
    "Kenya",
  ).result,
  // Too little known for a score: a card with no number.
  [C.Termly]: fitFixture(
    C.Termly,
    "Termly",
    { STAGE: "STRONG" },
    "GOOD_FIT",
    "Nigeria",
  ).result,
};

function relationshipsData() {
  return {
    yourSide: "INVESTOR",
    relationships: Object.entries(C).map(([name, id]) => ({
      relationshipId: randomUUID(),
      counterpart: { kind: "COMPANY", id, name },
      state: "INTEREST_EXPRESSED",
      stateSince: "2026-10-07T10:00:00.000Z",
      milestones: [],
      nextStep: "WAIT_FOR_RESPONSE",
    })),
    saved: [],
    passed: [],
    truthClass: "VERIFIED",
    source: "Capital Q relationship history",
  };
}

function tools(options: {
  readonly fit: boolean;
  readonly mandate?: boolean | undefined;
}): QToolPort & {
  readonly executed: string[];
} {
  const executed: string[] = [];
  const list = [
    offered("relationship.own.list", "list_my_relationships"),
    offered("discovery.companies", "discover_companies"),
    ...(options.mandate === true
      ? [offered("investor_mandate.get", "get_investor_mandate")]
      : []),
    ...(options.fit
      ? [
          offered("fit.profile", "fit_profile", "COMPARING_OPPORTUNITIES"),
          offered(
            "fit.top_candidates",
            "fit_top_candidates",
            "COMPARING_OPPORTUNITIES",
          ),
        ]
      : []),
  ];
  return {
    executed,
    offer: () => Promise.resolve(list),
    available: () => Promise.resolve(list),
    execute: (proposal: QToolProposal) => {
      executed.push(proposal.name);
      const ok = (toolName: string, data: unknown): QToolCallOutcome => ({
        callId: proposal.callId,
        toolName,
        toolVersion: 1,
        classification: "READ_ONLY",
        status: "SUCCEEDED",
        failureCode: null,
        sensitivity: "NETWORK_VISIBLE",
        result: { ok: true, data },
        latencyMs: 2,
      });
      if (proposal.name === "list_my_relationships") {
        return Promise.resolve(
          ok("relationship.own.list", relationshipsData()),
        );
      }
      if (proposal.name === "get_investor_mandate") {
        return Promise.resolve(
          ok("investor_mandate.get", {
            displayName: "Halyard Capital",
            investorType: "VC",
            mandates: [],
          }),
        );
      }
      if (proposal.name === "discover_companies") {
        // K1: the catalog's fintech companies, in name order.
        return Promise.resolve(
          ok("discovery.companies", {
            companies: (["Portside", "Souqsheet", "Termly"] as const).map(
              (name) => ({
                companyId: C[name],
                name,
                stageCode: "seed",
                headquartersCountry: "NG",
                shortDescription: null,
                sectors: ["Fintech"],
              }),
            ),
            order: "NAME",
            sectors: [{ code: "fintech", name: "Fintech" }],
            unknownSectors: [],
            truthClass: "USER_CLAIM",
          }),
        );
      }
      if (proposal.name === "fit_top_candidates") {
        return Promise.resolve(
          ok("fit.top_candidates", { status: "OK", comparison: null }),
        );
      }
      const id = (proposal.arguments as { companyId?: string }).companyId ?? "";
      const result = FITS[id] ?? {
        ok: true,
        data: { status: "NOT_FOUND" },
      };
      return Promise.resolve({
        ...ok("fit.profile", null),
        result,
      } as QToolCallOutcome);
    },
  };
}

function plan(): PermittedContextPlan {
  const parsed = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: randomUUID(),
    tenantId: TENANT,
    actor: { userId: USER },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
  // Their own firm's mandate is bound: the person is an investor.
  return {
    ...parsed,
    scopes: [
      {
        kind: "INVESTOR_MANDATE",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: OWN_FIRM,
        },
      },
    ],
  } as unknown as PermittedContextPlan;
}

async function replay(input: {
  readonly question: string;
  readonly script: readonly FakeBehaviour[];
  readonly fit?: boolean;
  readonly spoken?: boolean;
  readonly mandate?: boolean | undefined;
  /** What the turn reader read, as the answer seam passes it on. */
  readonly reading?: Pick<
    QAnswerRequest,
    "questionKind" | "fitQuestion" | "discoverCompanies" | "preparedSubject"
  >;
}): Promise<{
  text: string;
  blocks: readonly QResultBlock[];
  modelCalls: number;
  toolsOffered: number | null;
  executed: readonly string[];
}> {
  const run = randomUUID();
  const conversation = randomUUID();
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: input.script,
  });
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
      id: randomUUID() as QConversationMessage["id"],
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: conversation as QConversationMessage["conversationId"],
      runId: run as QConversationMessage["runId"],
      role: "USER",
      content: input.question,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    },
  ];
  const completed: { message?: { blocks?: QResultBlock[] } }[] = [];
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
    runs: { allocateEventSequence: () => Promise.resolve(1) },
    runEvents: {
      append: (
        _tx: unknown,
        row: { eventType?: string; payload?: unknown },
      ) => {
        if (row.eventType === "q.message.completed") {
          completed.push(row.payload as never);
        }
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const port = tools({ fit: input.fit ?? true, mandate: input.mandate });
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools: port,
  });
  const request: QAnswerRequest = {
    runId: run as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: plan(),
    turnKind: "QUESTION_TO_Q",
    ...(input.spoken === true ? { spoken: true } : {}),
    ...input.reading,
  };
  const outcome = await seam.answer(request);
  expect(outcome.kind).toBe("ANSWERED");
  return {
    text: messages.at(-1)?.content ?? "",
    blocks: completed.at(-1)?.message?.blocks ?? [],
    modelCalls: alpha.calls.length,
    toolsOffered: alpha.calls[0]?.request.tools.length ?? null,
    executed: port.executed,
  };
}

const answer = (
  text: string,
  extra: Record<string, unknown> = {},
): FakeBehaviour => ({
  kind: "TEXT",
  text: JSON.stringify({
    answer: text,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    clarifyingQuestions: [],
    declined: false,
    ...extra,
  }),
});

const cardsOf = (blocks: readonly QResultBlock[]) => {
  const block = blocks.find((b) => b.kind === "ANSWER_CARDS");
  return block?.kind === "ANSWER_CARDS" ? block.cards : [];
};

/** The lead's live replay after the first deploy (2026-10-07), verbatim where given. */
const LIVE_Q2 =
  "I've reached out to 20 companies so far. I can't provide mandate scores: no fit scores were returned for these relationships, and I won't manufacture them. The other contacted companies are listed on screen.";
const LIVE_Q3 =
  "The Kenya companies in your feed are Maji Loop and Baridi, and both match your stage range and regional focus—this is mandate alignment—not an investment conclusion. Maji Loop is the closer thematic fit; that is an inference from their descriptions, not a platform verdict. They're on screen. Want me to open one of them?";

describe("natural conversation: Zino's questions, live replay fixtures (2026-10-07)", () => {
  it("Q1 'What are the companies that you've reached out to?' -- first person, names, and cards for the companies named", async () => {
    const { text, blocks } = await replay({
      question: "What are the companies that you've reached out to?",
      script: [
        answer(
          "Capital Q records that you have expressed interest in Baridi, Portside, Souqsheet and Maji Loop. Their responses are still pending.",
        ),
      ],
    });
    expect(text).toMatch(/^You've expressed interest in Baridi/u);
    expect(naturalRegisterIssues(text, { spoken: true })).toEqual([]);
    expect(
      cardsOf(blocks)
        .map((card) => card.name)
        .sort(),
    ).toEqual(["Baridi", "Maji Loop", "Portside", "Souqsheet"].sort());
  });

  it("Q2 'List the companies… scores against the mandate… pros and cons' -- fits computed by code, cards, no model round, short named answer", async () => {
    const { text, blocks, modelCalls, executed } = await replay({
      question:
        "List the companies that have been reached out to so far and their scores against the mandate, including pros and cons of investing in them.",
      // What the model said live; it is never asked now.
      script: [answer(LIVE_Q2)],
    });
    expect(modelCalls).toBe(0);
    expect(executed.filter((name) => name === "fit_profile")).toHaveLength(5);
    const cards = cardsOf(blocks);
    expect(cards.map((card) => card.name)).toEqual([
      "Souqsheet",
      "Portside",
      "Maji Loop",
      "Baridi",
      "Termly",
    ]);
    for (const card of cards.slice(0, 4)) {
      expect(card.fit?.score).toBeGreaterThan(0);
      expect(card.reasons.length).toBeGreaterThan(0);
    }
    expect(cards.at(-1)?.fit).toBeNull();
    // Built from the facts (research 2026-10-07 §4): the set, the top
    // three by name with their scores, the caveats, then the open door.
    expect(text).toBe(
      "I looked at the five companies you've reached out to. The strongest fits for your mandate: Souqsheet at 10; then Portside at 8.5; then Maji Loop at 8. Cheque size isn't known for any of them yet. One doesn't have enough information for a score yet. I've put them on screen. Want me to dig into one?",
    );
    expect(text).not.toMatch(/fits best, at|out of 10|Pros and cons/u);
    expect(text).not.toMatch(/can't provide|manufacture/u);
    expect(naturalRegisterIssues(text)).toEqual([]);
  });

  it("Q3 'Which specific companies in Kenya closely match the criteria?' -- the Kenya set only, cards, no disclaimers", async () => {
    const { text, blocks, modelCalls } = await replay({
      question: "Which specific companies in Kenya closely match the criteria?",
      script: [answer(LIVE_Q3)],
    });
    expect(modelCalls).toBe(0);
    expect(cardsOf(blocks).map((card) => card.name)).toEqual([
      "Maji Loop",
      "Baridi",
    ]);
    expect(text).toMatch(/^In Kenya, I looked at two companies\./u);
    expect(text).toMatch(/Maji Loop at [\d.]+; then Baridi at [\d.]+/u);
    expect(naturalRegisterIssues(text, { spoken: true })).toEqual([]);
    expect(text.split(/\s+/u).length).toBeLessThanOrEqual(SPOKEN_WORDS_MAX);
  });

  it("without fit available, the live answers lose the unbacked 'on screen' and the repeated disclaimers", async () => {
    const q2 = await replay({
      question:
        "List the companies that have been reached out to so far and their scores against the mandate, including pros and cons of investing in them.",
      script: [answer(LIVE_Q2)],
      fit: false,
    });
    expect(cardsOf(q2.blocks)).toEqual([]);
    expect(q2.text).not.toMatch(/on screen/iu);
    expect(q2.text).toMatch(/^I've reached out to 20 companies so far\./u);

    const q3 = await replay({
      question: "Which specific companies in Kenya closely match the criteria?",
      script: [answer(LIVE_Q3)],
      fit: false,
    });
    expect(cardsOf(q3.blocks)).toEqual([]);
    expect(q3.text).not.toMatch(/on screen/iu);
    expect(q3.text).not.toMatch(/investment conclusion|mandate alignment/u);
    expect(naturalRegisterIssues(q3.text)).not.toContain("REPEATED_DISCLAIMER");
  });

  it("a spoken list answer with cards is at most three sentences before 'on screen'", async () => {
    const { text, blocks } = await replay({
      question: "What are the companies that you've reached out to?",
      spoken: true,
      script: [
        answer(
          "You've expressed interest in Baridi, Portside, Souqsheet and Maji Loop. Baridi is in Kenya. Portside is in Egypt. Souqsheet is in Nigeria. Maji Loop is in Kenya too.",
        ),
      ],
    });
    expect(cardsOf(blocks).length).toBeGreaterThanOrEqual(2);
    expect(text).toBe(
      "You've expressed interest in Baridi, Portside, Souqsheet and Maji Loop. Baridi is in Kenya. Portside is in Egypt. The details are on screen.",
    );
  });
});

describe("a fit question in any words reaches the computed fit (live 2026-10-09)", () => {
  // Zino, production 677c9f53, 07:29-07:32 UTC: read as ADVICE and
  // researched on the public web, 23.2 s and 30.2 s. The turn reader now
  // reads FIT with its count; the words themselves decide nothing.
  const ASK = "Give me three good examples of companies I can invest in";
  const fit = (text: string, count: number | null) => ({
    questionKind: "FIT",
    fitQuestion: { text, count },
  });

  it("answers the reader's FIT from computed fits: exact count, no model, no web", async () => {
    const started = Date.now();
    const { text, blocks, modelCalls, executed } = await replay({
      question: ASK,
      script: [answer("A slow researched answer.")],
      reading: fit(ASK, 3),
    });
    expect(modelCalls).toBe(0);
    expect(cardsOf(blocks)).toHaveLength(3);
    expect(executed).not.toContain("research_public_web");
    expect(
      executed.filter((name) => name.startsWith("fit_")).length,
    ).toBeGreaterThan(0);
    expect(text).toMatch(/Souqsheet/u);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("'still waiting, can you do it or not' re-answers the pending ask, read as it", async () => {
    const { blocks, modelCalls } = await replay({
      question: "Still waiting, can you do it or not",
      script: [answer("A fresh analysis.")],
      reading: fit(ASK, 3),
    });
    expect(modelCalls).toBe(0);
    expect(cardsOf(blocks)).toHaveLength(3);
  });

  it("other wordings, with no number, are the same path", async () => {
    for (const words of [
      "which ones could I actually invest in",
      "best companies for me",
    ]) {
      const { blocks, modelCalls } = await replay({
        question: words,
        script: [answer("A model answer.")],
        reading: fit(words, null),
      });
      expect(modelCalls).toBe(0);
      expect(cardsOf(blocks).length).toBeGreaterThan(0);
    }
  });

  it("without the reader's FIT the same words are not swept by code", async () => {
    const { modelCalls } = await replay({
      question: ASK,
      script: [answer("You could look at Souqsheet.")],
    });
    expect(modelCalls).toBeGreaterThan(0);
  });
});

describe("companies of a kind through the answer path (K1, live 2026-10-09 15:57)", () => {
  it("'show me three fintech companies': three catalog cards, the basis said, no model call", async () => {
    const started = Date.now();
    const { text, blocks, modelCalls, executed } = await replay({
      question: "Show me three fintech companies",
      script: [answer("Your mandate focuses on fintech across Africa.")],
      reading: {
        questionKind: "DISCOVER_COMPANIES",
        discoverCompanies: {
          text: "Show me three fintech companies",
          sectors: ["fintech"],
          countries: [],
          stages: [],
          count: 3,
          ranking: "NONE",
          mandateRelevant: false,
          previous: false,
        },
      },
    });
    expect(modelCalls).toBe(0);
    expect(cardsOf(blocks).map((card) => card.name)).toEqual([
      "Portside",
      "Souqsheet",
      "Termly",
    ]);
    expect(text).toBe(
      "Here are three fintech companies on Capital Q: Portside, Souqsheet and Termly. They're listed by name, not ranked. They're on screen.",
    );
    expect(executed).not.toContain("research_public_web");
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("the cheapest correct path (K8)", () => {
  it("'what is my mandate' with the mandate prepared: one model call, no tool round", async () => {
    const { modelCalls, toolsOffered } = await replay({
      question: "what is my mandate?",
      mandate: true,
      script: [answer("Halyard Capital invests as a VC; no mandate yet.")],
      reading: {
        questionKind: "THEIR_OWN_RECORDS",
        preparedSubject: "MANDATE",
      },
    });
    expect(modelCalls).toBe(1);
    expect(toolsOffered).toBe(0);
  });

  it("the same question with nothing prepared keeps the full path and its tools", async () => {
    const { toolsOffered } = await replay({
      question: "what is my mandate?",
      script: [answer("Let me look.")],
      reading: {
        questionKind: "THEIR_OWN_RECORDS",
        preparedSubject: "MANDATE",
      },
    });
    expect(toolsOffered).toBeGreaterThan(0);
  });
});
