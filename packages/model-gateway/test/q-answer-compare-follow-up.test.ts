import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
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
 * Coordinator 23 Oct 2026: right after "Show me the five companies that
 * best fit my mandate" (cards: Mizan, Silo Credit, …), "Compare the top two
 * side by side" came back as two sentences and no table, because the
 * follow-up read nothing. The two on screen are now read (profile, figures,
 * fit, in parallel) before the model is asked, the table is built by code,
 * and the answer is spoken from the same cells. Fake model; no provider.
 */

const MIZAN = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const SILO = "7e5a7a76-857a-4528-9641-08c7bab9cc22";
const OTHERS = [
  "7e5a7a76-857a-4528-9641-08c7bab9cc23",
  "7e5a7a76-857a-4528-9641-08c7bab9cc24",
  "7e5a7a76-857a-4528-9641-08c7bab9cc25",
];

const offered = (
  name: string,
  toolName: string,
  stage: QOfferedTool["visibleStage"],
): QOfferedTool => ({
  toolName,
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name,
    description: name,
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: stage,
});

const OFFERED = [
  offered("get_company", "company.get", "REVIEWING_COMPANY"),
  offered("read_company_figures", "company.figures.read", "REVIEWING_COMPANY"),
  offered("fit_profile", "fit.profile", "COMPARING_OPPORTUNITIES"),
];

const PROFILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [MIZAN]: {
    canonicalName: "Mizan",
    headquartersCountry: "EG",
    headquartersCity: "Cairo",
    currentStageCode: "SEED",
    shortDescription: "Sharia-compliant payments for merchants.",
  },
  [SILO]: {
    canonicalName: "Silo Credit",
    headquartersCountry: "NG",
    headquartersCity: "Kano",
    currentStageCode: "PRE_SEED",
    shortDescription: "Inventory credit for agri-dealers.",
  },
};

function outcome(proposal: QToolProposal): Omit<QToolCallOutcome, "callId"> {
  const companyId = String(
    Reflect.get(proposal.arguments as object, "companyId"),
  );
  const base = {
    toolVersion: 1,
    classification: "READ_ONLY",
    status: "SUCCEEDED",
    failureCode: null,
    sensitivity: "INTERNAL",
    latencyMs: 1,
  } as const;
  if (proposal.name === "get_company") {
    const profile = PROFILES[companyId] ?? {};
    return {
      ...base,
      toolName: "company.get",
      result: {
        ok: true,
        data: {
          companyId,
          canonicalName: profile["canonicalName"],
          legalName: null,
          websiteUrl: null,
          foundedDate: null,
          headquartersCountry: profile["headquartersCountry"],
          headquartersCity: profile["headquartersCity"],
          currentStageCode: profile["currentStageCode"],
          shortDescription: profile["shortDescription"],
          primaryDescription: null,
          companyStatus: "ACTIVE",
          relationToYou: "SHARED",
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
              key: "revenue.mrr",
              statement:
                companyId === MIZAN
                  ? "Monthly recurring revenue is $42,000."
                  : "Monthly recurring revenue is $9,000.",
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
  return {
    ...base,
    ...fitFixture(
      companyId,
      PROFILES[companyId]?.["canonicalName"] ?? "?",
      companyId === MIZAN
        ? { STAGE: "STRONG", SECTOR: "STRONG" }
        : { STAGE: "PARTIAL", SECTOR: "STRONG" },
    ),
  };
}

const analyst = (answer: string): FakeBehaviour => ({
  kind: "JSON",
  value: {
    answer,
    responseShape: "CONCISE",
    findings: [],
    missingEvidence: [],
    contradictions: [],
    insufficientEvidence: false,
    recommendation: null,
    clarifyingQuestions: [],
    declined: false,
  },
});

function build(
  said: string,
  reading?: Readonly<Record<string, unknown>>,
  answer = "Mizan is in Cairo doing merchant payments at $42,000 MRR; Silo Credit is in Kano lending to agri-dealers at $9,000.",
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [analyst(answer)],
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
  const cards = [MIZAN, SILO, ...OTHERS].map((companyId, index) => ({
    name:
      (PROFILES[companyId]?.["canonicalName"] ?? "") ||
      `Company ${String(index)}`,
    subject: { kind: "COMPANY", companyId },
  }));
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: randomUUID(),
      role: "USER",
      content: "Show me the five companies that best fit my mandate",
      contentType: "TEXT",
      createdAt: at,
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: randomUUID(),
      role: "Q",
      content: "Here are the five that fit your mandate best.",
      contentType: "TEXT",
      blocks: [{ kind: "ANSWER_CARDS", cards }],
      createdAt: at,
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: at,
    },
  ] as unknown as QConversationMessage[];
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const executed: QToolProposal[] = [];
  const stored: { content: string; blocks?: readonly unknown[] }[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      return Promise.resolve({
        callId: proposal.callId,
        ...outcome(proposal),
      } as QToolCallOutcome);
    },
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { content: string; blocks?: readonly unknown[] },
      ) => {
        stored.push(input);
        return Promise.resolve({
          ...messages[2],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
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
    ...(reading ?? {}),
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: run,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
      subjects: [],
      screen: { route: "HOME" },
      scopes: [
        { kind: "OWN_Q_CONVERSATION" },
        // An investor with a mandate: their fit question is swept by code.
        {
          kind: "INVESTOR_MANDATE",
          subject: {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: "1c4b9266-350c-409d-9582-04a0f771b8a8",
          },
        },
      ],
      denied: [],
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed, stored };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("compare the top two, right after a list of five", () => {
  it("reads both on screen, builds the table, and speaks the differences", async () => {
    const { seam, request, alpha, executed, stored } = build(
      "Compare the top two side by side",
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const compareCalls = executed.filter((call) =>
      call.callId.startsWith("q-compare-"),
    );
    // Profile, figures and fit for the first two cards, and no others.
    for (const companyId of [MIZAN, SILO]) {
      for (const name of [
        "get_company",
        "read_company_figures",
        "fit_profile",
      ]) {
        expect(compareCalls).toContainEqual(
          expect.objectContaining({ name, arguments: { companyId } }),
        );
      }
    }
    expect(compareCalls).toHaveLength(6);
    const sent = sentTo(alpha);
    expect(sent).toContain("COMPARED SIDE BY SIDE");
    expect(sent).toContain("Mizan vs Silo Credit");
    expect(sent).toContain("real differences");
    const blocks = stored.at(-1)?.blocks ?? [];
    const table = blocks.find(
      (block) => Reflect.get(block as object, "kind") === "TABLE",
    ) as
      | {
          columns: { label: string }[];
          rows: { label: string; cells: string[] }[];
        }
      | undefined;
    expect(table?.columns.map((column) => column.label)).toEqual([
      "Mizan",
      "Silo Credit",
    ]);
    const traction = table?.rows.find((row) => row.label === "Traction");
    expect(traction?.cells[0]).toContain("$42,000");
    expect(traction?.cells[1]).toContain("$9,000");
  });

  it("the same, when the turn was read as a fit question (live 23 Oct, run f5415b0c)", async () => {
    const { seam, request, alpha, executed, stored } = build(
      "Compare the top two side by side",
      {
        questionKind: "FIT",
        turnKind: "QUESTION_TO_Q",
        aboutNamedOther: false,
        fitQuestion: {
          text: "Compare the top two side by side",
          count: 2,
          previous: true,
        },
      },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(
      executed.filter((call) => call.callId.startsWith("q-compare-")),
    ).toHaveLength(6);
    expect(sentTo(alpha)).toContain("COMPARED SIDE BY SIDE");
    const blocks = stored.at(-1)?.blocks ?? [];
    const table = blocks.find(
      (block) => Reflect.get(block as object, "kind") === "TABLE",
    ) as { columns: { label: string }[] } | undefined;
    // The two compared, never the rest of the sweep's companies.
    expect(table?.columns.map((column) => column.label)).toEqual([
      "Mizan",
      "Silo Credit",
    ]);
  });

  // Live 23 Oct 21:49 (run a19bae24): read as a tool request, the model
  // offered to compare instead of comparing, and no table came.
  it("the same, when the turn was read as a tool request", async () => {
    const { seam, request, executed, stored } = build(
      "Compare the top two side by side",
      { turnKind: "TOOL_REQUEST", aboutNamedOther: false },
      // The live reply, word for word in shape.
      "The top two are Mizan and Silo Credit, tied on mandate fit at 7.6. I can compare their stage, sector, geography, cheque compatibility, thesis and round terms side by side.",
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(
      executed.filter((call) => call.callId.startsWith("q-compare-")),
    ).toHaveLength(6);
    const last = stored.at(-1);
    const table = (last?.blocks ?? []).find(
      (block) => Reflect.get(block as object, "kind") === "TABLE",
    ) as { columns: { label: string }[] } | undefined;
    expect(table?.columns.map((column) => column.label)).toEqual([
      "Mizan",
      "Silo Credit",
    ]);
    expect(last?.content).not.toMatch(/\bI can compare\b/iu);
  });

  it("an ordinary follow-up reads nothing extra", async () => {
    const { seam, request, executed } = build("Tell me more about Mizan");
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(
      executed.filter((call) => call.callId.startsWith("q-compare-")),
    ).toEqual([]);
  });
});
