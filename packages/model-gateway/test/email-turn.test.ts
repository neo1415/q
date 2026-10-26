import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

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
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * B (coordinator 2026-10-26, run 42cecfd2: 18.3 s): a founder's asked email
 * ran three ~48k-token rounds, reading their own figures in one of them,
 * and a second writer started on a round's prose was cancelled when that
 * round turned to its tools. An asked note or email is offered only the
 * reads it needs and the tool that prepares it, starts with their own
 * figures read beside the other reads, and has no second writer. Decided
 * by the asked action the reader read, never by the words.
 */

const COMPANY = "61000000-0000-4000-8000-000000000001";
const FIGURE = "Monthly revenue was 42,000 USD in September 2026.";
const BODY = `Hi Savanna team, an update: ${FIGURE}`;

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
  offered("propose_email", "relationship.email.propose"),
  offered("list_my_relationships", "relationship.list"),
  offered("read_company_figures", "company.figures"),
  offered("fit_top_candidates", "fit.top_candidates"),
  offered("list_schedule", "calendar.schedule"),
];

const answer = (text: string) => ({
  kind: "JSON" as const,
  value: {
    answer: text,
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

function build(options: { asked?: string; ownProfileScope?: boolean } = {}) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TOOL_CALLS",
        calls: [
          {
            callId: "e",
            name: "propose_email",
            arguments: { counterpartName: "Savanna Seed Partners", body: BODY },
          },
        ],
      },
      answer("I've prepared the email for your approval."),
      answer("Nothing further."),
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
  const said =
    "Draft an email to Savanna Seed Partners with our latest traction.";
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: said,
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as never,
  ];
  const executed: QToolProposal[] = [];
  const ok = (proposal: QToolProposal, toolName: string, data: unknown) =>
    ({
      callId: proposal.callId,
      toolName,
      toolVersion: 1,
      classification: "READ_ONLY",
      status: "SUCCEEDED",
      failureCode: null,
      sensitivity: "PUBLIC",
      result: { ok: true, data },
      latencyMs: 1,
    }) as QToolCallOutcome;
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      if (proposal.name === "read_company_figures") {
        return Promise.resolve(
          ok(proposal, "company.figures", {
            figures: [
              {
                statement: FIGURE,
                truthClass: "USER_CLAIM",
                evidenceStatus: "SELF_REPORTED",
                asOf: "2026-09-30",
              },
            ],
          }),
        );
      }
      if (proposal.name === "propose_email") {
        return Promise.resolve(
          ok(proposal, "relationship.email.propose", {
            status: "PREPARED",
            awaitingApprovalOf: "Email Savanna Seed Partners",
          }),
        );
      }
      return Promise.resolve(ok(proposal, "unused", null));
    },
  };
  const repositories: QRuntimeRepositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) =>
        Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage),
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as never;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    parallelExtras: true,
    ownCompanySnapshot: () =>
      Promise.resolve({
        companyId: COMPANY,
        name: "Tamba Freight",
        shortDescription: "Freight marketplace for West Africa.",
        stageCode: "seed",
        countryCode: "GH",
      }),
  });
  const actor = ActorContextSchema.parse({
    userId: USER,
    tenantId: TENANT,
    actorType: "HUMAN",
  });
  const request: QAnswerRequest = {
    runId: run,
    tenantId: TENANT,
    actorUserId: USER,
    actor,
    correlationId: `cor_${run}`,
    capability: "ANSWER",
    subjects: [],
    ...(options.asked === undefined ? {} : { askedAction: options.asked }),
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
        ...(options.ownProfileScope === false
          ? []
          : [{ kind: "COMPANY_PROFILE", companyId: COMPANY }]),
      ],
      denied: [],
      maxSensitivity: "PUBLIC",
    },
  } as never;
  return { seam, request, alpha, executed };
}

const ownFigureReads = (executed: readonly QToolProposal[]) =>
  executed.filter((call) => call.callId === "q-own-figures");
const offeredTo = (call: {
  request: { tools?: readonly { name: string }[] };
}) => (call.request.tools ?? []).map((tool) => tool.name);
const promptOf = (call: {
  request: { messages: readonly { content: string }[] };
}) => call.request.messages.map((m) => m.content).join("\n");

describe("an asked email is one focused round (coordinator 2026-10-26, B)", () => {
  it("offers only the reads it needs and the tool that prepares it", async () => {
    const { seam, request, alpha } = build({ asked: "propose_email" });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    const first = alpha.calls[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(offeredTo(first).sort()).toEqual(
      ["list_my_relationships", "propose_email", "read_company_figures"].sort(),
    );
  });

  it("starts with their own figures, read by code beside the other reads", async () => {
    const { seam, request, alpha, executed } = build({
      asked: "propose_email",
    });
    await seam.answer(request);
    expect(ownFigureReads(executed)).toHaveLength(1);
    expect(ownFigureReads(executed)[0]?.arguments).toEqual({
      companyId: COMPANY,
    });
    const first = alpha.calls[0];
    if (first === undefined) throw new Error("no model call");
    expect(promptOf(first)).toContain(FIGURE);
    expect(executed.map((call) => call.name)).toContain("propose_email");
  });

  it("has no second writer: the prepared card is the answer", async () => {
    const { seam, request, alpha } = build({ asked: "propose_email" });
    await seam.answer(request);
    // The round that prepares it, then the answer: no extras' call.
    expect(alpha.calls).toHaveLength(2);
    for (const call of alpha.calls) {
      expect(promptOf(call)).not.toContain("A second writer");
    }
  });

  it("reads no figures where the plan does not hold their own company's profile", async () => {
    const { seam, request, executed } = build({
      asked: "propose_email",
      ownProfileScope: false,
    });
    await seam.answer(request);
    expect(ownFigureReads(executed)).toHaveLength(0);
  });

  it("a turn with no asked message keeps its tools and reads no figures ahead", async () => {
    const { seam, request, alpha, executed } = build();
    await seam.answer(request);
    expect(ownFigureReads(executed)).toHaveLength(0);
    const first = alpha.calls[0];
    if (first === undefined) throw new Error("no model call");
    expect(offeredTo(first)).toContain("fit_top_candidates");
  });
});
