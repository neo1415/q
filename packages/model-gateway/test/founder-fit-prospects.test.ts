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
 * F-133 (live bf1dcaa8 on a3f2a0f81): "Which investors fit me?" from a
 * founder was read as FIT, so it went to the analyst, which named
 * investors with a model-made sector "Partial". A fit question is fit
 * with one's own mandate, which only an investor has: from a founder it
 * is which investors fit their company, answered by code from what
 * investors publish. Decided by who asks, never by the words.
 */

const COMPANY = "61000000-0000-4000-8000-000000000001";
const SAVANNA = "62000000-0000-4000-8000-000000000002";
const INVESTOR_ORG = "63000000-0000-4000-8000-000000000003";

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

const OFFERED = [
  offered("find_prospective_investors", "investor.prospects"),
  offered("list_incoming_interest", "investor.interest.incoming"),
  offered("fit_top_candidates", "fit.top_candidates"),
  offered("fit_profile", "fit.profile"),
];

function build(
  side: "FOUNDER" | "INVESTOR",
  options: { named?: boolean } = {},
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer: "The analyst's own answer.",
          responseShape: "CONCISE",
          findings: [],
          missingEvidence: [],
          contradictions: [],
          insufficientEvidence: false,
          recommendation: null,
          clarifyingQuestions: [],
          declined: false,
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
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: conversation,
      runId: run,
      role: "USER",
      content: "Which investors fit me?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as never,
  ];
  const executed: QToolProposal[] = [];
  const stored: { content: string }[] = [];
  const ok = (proposal: QToolProposal, toolName: string, data: unknown) =>
    ({
      callId: proposal.callId,
      toolName,
      toolVersion: 1,
      classification: "READ_ONLY",
      status: "SUCCEEDED",
      failureCode: null,
      sensitivity: "NETWORK_VISIBLE",
      result: { ok: true, data },
      latencyMs: 1,
    }) as QToolCallOutcome;
  const tools: QToolPort = {
    offer: () => Promise.resolve(OFFERED),
    execute: (proposal) => {
      executed.push(proposal);
      if (proposal.name === "find_prospective_investors") {
        return Promise.resolve(
          ok(proposal, "investor.prospects", {
            fitVersion: "prospect-fit.v2",
            companySource: "CAPITAL_Q_RECORD",
            compared: { countryCode: "GH", stageCode: "seed" },
            prospects: [
              {
                investorOrganisationId: SAVANNA,
                name: "Savanna Seed Partners",
                investorType: "VC",
                hqCountry: null,
                publicDescription: null,
                deploymentState: "ACTIVELY_INVESTING",
                reasons: [
                  {
                    kind: "DEPLOYING",
                    detail: "says it is actively investing",
                  },
                ],
                label: "likely fit, not evidence of interest",
                gate: null,
                publishedFit: {
                  stage: "MET",
                  sector: "UNKNOWN",
                  geography: "MET",
                },
                fitKnown: true,
              },
            ],
            notes: [],
          }),
        );
      }
      if (proposal.name === "list_incoming_interest") {
        return Promise.resolve(
          ok(proposal, "investor.interest.incoming", { interests: [] }),
        );
      }
      return Promise.resolve(ok(proposal, "unused", null));
    },
  };
  const repositories: QRuntimeRepositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, input: { content: string }) => {
        stored.push(input);
        return Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
      },
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
    // Their own company: a founder has one, an investor here does not.
    ownCompanySnapshot: () =>
      Promise.resolve(
        side === "FOUNDER"
          ? {
              companyId: COMPANY,
              name: "Tamba Freight",
              shortDescription: "Freight marketplace for West Africa.",
              stageCode: "seed",
              countryCode: "GH",
            }
          : null,
      ),
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
    questionKind: "FIT",
    fitQuestion: { text: "Which investors fit me?", count: null },
    ...(options.named === true ? { aboutNamedOther: true } : {}),
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
        ...(side === "INVESTOR"
          ? [
              {
                kind: "INVESTOR_MANDATE",
                subject: {
                  kind: "INVESTOR_ORGANISATION",
                  investorOrganisationId: INVESTOR_ORG,
                },
              },
            ]
          : []),
      ],
      denied: [],
      maxSensitivity: "PUBLIC",
    },
  } as never;
  return { seam, request, alpha, executed, stored };
}

const codeProspects = (executed: readonly QToolProposal[]) =>
  executed.filter((call) => call.callId === "q-investor-prospects");

describe("a founder's fit question is which investors fit their company (F-133)", () => {
  it("is answered by code from what investors publish, with no analyst call", async () => {
    const { seam, request, alpha, executed, stored } = build("FOUNDER");
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(codeProspects(executed)).toHaveLength(1);
    expect(codeProspects(executed)[0]?.arguments).toMatchObject({
      companyId: COMPANY,
    });
    expect(alpha.calls).toHaveLength(0);
    expect(stored.at(-1)?.content).toContain("Savanna Seed Partners");
  });

  it("about one named investor, keeps the full path", async () => {
    const { seam, request, executed } = build("FOUNDER", { named: true });
    await seam.answer(request);
    expect(codeProspects(executed)).toHaveLength(0);
  });

  it("from an investor, is still their mandate's fit, never the prospects", async () => {
    const { seam, request, executed } = build("INVESTOR");
    await seam.answer(request);
    expect(codeProspects(executed)).toHaveLength(0);
  });
});
