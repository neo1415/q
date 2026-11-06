import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QOfferedTool,
  QRetrievalFocus,
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
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Live 2026-11-06 (production 347b74a8c, fictional investor):
 *   1. "What does Ledgerfold do?"
 *   2. "How many borrowers does it have, and what's its loan book?"
 * Q gave the loan book and said it had no borrower number, though the
 * company's published figures carry 2,150 borrowers and "How many
 * borrowers does Ledgerfold have?" answered it. A company NAMED in the
 * words has its profile, figures and deck read before the model; one the
 * reader bound a pronoun to ("it" = Ledgerfold, step 3) had none of them,
 * so every part of a follow-up rested on whatever the model chose to look
 * up. Each part's fact must reach the answer context. Fake model; no
 * provider.
 */

const LEDGERFOLD = "5b1f3c6e-7a1d-4c2b-9e3f-1a2b3c4d5e6f";
const OTHER = "6c2a4d7f-8b2e-4d3c-8f4a-2b3c4d5e6f70";

const offered = (name: string, toolName: string): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_COMPANY",
});

const OFFERED = [
  offered("search_companies", "company.search"),
  offered("get_company", "company.get"),
  offered("read_company_figures", "company.figures.read"),
  offered("read_company_deck", "company.deck.read"),
];

const base = {
  toolVersion: 1,
  classification: "READ_ONLY",
  status: "SUCCEEDED",
  failureCode: null,
  sensitivity: "INTERNAL",
  latencyMs: 1,
} as const;

function outcome(
  proposal: QToolProposal,
  denied: ReadonlySet<string>,
): Omit<QToolCallOutcome, "callId"> {
  const companyId = String(
    Reflect.get(proposal.arguments as object, "companyId"),
  );
  if (denied.has(companyId)) {
    return {
      ...base,
      toolName: proposal.name,
      status: "DENIED",
      failureCode: "NOT_AUTHORISED",
      result: { ok: false, error: { code: "NOT_AUTHORISED" } },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  if (proposal.name === "search_companies") {
    return {
      ...base,
      toolName: "company.search",
      result: { ok: true, data: { items: [] } },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  if (proposal.name === "get_company") {
    return {
      ...base,
      toolName: "company.get",
      result: {
        ok: true,
        data: {
          companyId,
          canonicalName: "Ledgerfold",
          legalName: null,
          websiteUrl: null,
          foundedDate: null,
          headquartersCountry: "KE",
          headquartersCity: "Nairobi",
          currentStageCode: "SEED",
          shortDescription: "Working-capital loans for informal retailers.",
          primaryDescription: null,
          companyStatus: "active",
          relationToYou: "NETWORK_VISIBLE",
          truthClass: "USER_CLAIM",
        },
      },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  if (proposal.name === "read_company_figures") {
    return {
      ...base,
      toolName: "company.figures.read",
      result: {
        ok: true,
        data: {
          companyId,
          status: "AVAILABLE",
          figures: [
            {
              key: "customers.count",
              statement: "Ledgerfold has 2,150 active borrowers.",
              value: null,
              asOf: "2026-09-30",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
            {
              key: "loan_book.size",
              statement:
                "Ledgerfold's loan book is USD 410,000, up from USD 150,000; PAR30 is 3.8%.",
              value: null,
              asOf: "2026-09-30",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              lifecycleStatus: "CURRENT",
            },
          ],
        },
      },
    } as unknown as Omit<QToolCallOutcome, "callId">;
  }
  // read_company_deck: no deck for this company.
  return {
    ...base,
    toolName: "company.deck.read",
    status: "FAILED",
    failureCode: "NOT_FOUND",
    result: { ok: false, error: { code: "NOT_FOUND" } },
  } as unknown as Omit<QToolCallOutcome, "callId">;
}

function ledgerOf(id: string): QRetrievalFocus["ledger"] {
  return {
    entities: [
      {
        ref: "E1",
        kind: "COMPANY",
        id,
        name: "Ledgerfold",
        firstTurn: 1,
        lastTurn: 2,
        via: ["SAID_BY_THEM", "FETCHED"],
        of: null,
        value: null,
      },
    ],
    lists: [],
  };
}

function build(input: {
  readonly said: string;
  readonly focus?: QRetrievalFocus | undefined;
  readonly denied?: readonly string[];
}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer:
            "Ledgerfold reports 2,150 borrowers and a USD 410,000 loan book.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
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
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const run = randomUUID();
  const conversation = randomUUID();
  const at = new Date().toISOString();
  const message = (
    role: "USER" | "Q",
    content: string,
    runId = randomUUID(),
  ) => ({
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: conversation,
    runId,
    role,
    content,
    contentType: "TEXT",
    createdAt: at,
  });
  const messages = [
    message("USER", "What does Ledgerfold do?"),
    message(
      "Q",
      "Ledgerfold, by its own profile, gives working-capital loans to informal retailers in Nairobi.",
    ),
    message("USER", input.said, run),
  ] as unknown as QConversationMessage[];
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const executed: QToolProposal[] = [];
  const denied = new Set(input.denied ?? []);
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve({
        callId: proposal.callId,
        ...outcome(proposal, denied),
      } as QToolCallOutcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, row: { content: string }) =>
        Promise.resolve({
          ...messages[2],
          id: randomUUID(),
          role: "Q",
          content: row.content,
        } as QConversationMessage),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
  });
  const request = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    ...(input.focus === undefined ? {} : { retrievalFocus: input.focus }),
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [{ kind: "OWN_Q_CONVERSATION" }],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

const SAID = "How many borrowers does it have, and what's its loan book?";

describe("a compound follow-up about the company a pronoun points at", () => {
  it("reads the bound company's profile and figures before the model, so every part's fact reaches the answer", async () => {
    const { seam, request, alpha, executed } = build({
      said: SAID,
      focus: { ledger: ledgerOf(LEDGERFOLD), boundRefs: ["E1"] },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    for (const name of ["get_company", "read_company_figures"]) {
      expect(executed).toContainEqual(
        expect.objectContaining({ name, arguments: { companyId: LEDGERFOLD } }),
      );
    }
    const sent = sentTo(alpha);
    expect(sent).toContain("2,150 active borrowers");
    expect(sent).toContain("USD 410,000");
  });

  it("reads nothing for a company the ledger only recalls (no binding this turn)", async () => {
    const { seam, request, executed } = build({
      said: SAID,
      focus: { ledger: ledgerOf(LEDGERFOLD), boundRefs: [] },
    });
    await seam.answer(request);
    expect(
      executed.filter((call) => call.callId.startsWith("q-bound-company-")),
    ).toEqual([]);
  });

  it("adds nothing when the bound company's read is refused for this person", async () => {
    const { seam, request, alpha, executed } = build({
      said: SAID,
      focus: { ledger: ledgerOf(OTHER), boundRefs: ["E1"] },
      denied: [OTHER],
    });
    await seam.answer(request);
    // The read was asked through the tool, under the plan, and refused.
    expect(executed).toContainEqual(
      expect.objectContaining({
        name: "get_company",
        arguments: { companyId: OTHER },
      }),
    );
    expect(sentTo(alpha)).not.toContain("2,150 active borrowers");
  });
});
