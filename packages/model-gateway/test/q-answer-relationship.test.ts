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
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import { relationshipFact } from "../src/q/relationship-fact.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Relationship-aware answers (CQ-Q-030). When the question is about a
 * counterparty, where the person's own side stands with it is read
 * through the same get_relationship tool the model could call, under the
 * same plan, and placed among the authorised facts in words with dates --
 * never as a field dump. Nothing on record adds nothing; a refused read
 * adds nothing.
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const RELATIONSHIP = randomUUID();
const INVESTOR = randomUUID();

const RELATIONSHIP_TOOL: QOfferedTool = {
  toolName: "relationship.get",
  toolVersion: 1,
  classification: "READ_ONLY",
  definition: {
    name: "get_relationship",
    description: "Where the person's own side stands with a counterparty.",
    inputJsonSchema: { type: "object", properties: {} },
  },
  visibleStage: "REVIEWING_RELATIONSHIP",
};

const CONNECTED = {
  yourSide: "INVESTOR",
  counterpart: { kind: "COMPANY", id: COMPANY, name: "Kora" },
  relationship: {
    state: "CONNECTED",
    stateSince: "2026-09-25T11:00:00.000Z",
    milestones: [
      { state: "DISCOVERED", at: "2026-09-20T09:00:00.000Z" },
      { state: "INTEREST_EXPRESSED", at: "2026-09-24T10:00:00.000Z" },
      { state: "CONNECTED", at: "2026-09-25T11:00:00.000Z" },
    ],
    nextStep: "SCHEDULE_MEETING",
  },
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
};

type Subject =
  | { readonly kind: "COMPANY"; readonly companyId: string }
  | { readonly kind: "RELATIONSHIP"; readonly relationshipId: string };

function build(
  read: { status: "SUCCEEDED" | "DENIED"; data?: unknown },
  subject: Subject = { kind: "COMPANY", companyId: COMPANY },
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "TEXT",
        text: JSON.stringify({
          answer: "You connected with Kora on 25 September.",
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
        }),
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
  const messages = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: "Where are we with Kora?",
      contentType: "TEXT",
      createdAt: new Date().toISOString(),
    } as unknown as QConversationMessage,
  ];
  const executed: QToolProposal[] = [];
  const tools: QToolPort = {
    offer: () => Promise.resolve([RELATIONSHIP_TOOL]),
    execute: (proposal) => {
      executed.push(proposal);
      const outcome: QToolCallOutcome = {
        callId: proposal.callId,
        toolName: "relationship.get",
        toolVersion: 1,
        classification: "READ_ONLY",
        status: read.status,
        failureCode: read.status === "DENIED" ? "NOT_AVAILABLE" : null,
        sensitivity: read.status === "DENIED" ? null : "CONFIDENTIAL",
        result:
          read.status === "DENIED"
            ? {
                ok: false,
                error: {
                  code: "NOT_AVAILABLE",
                  message: "Not available in this conversation's context.",
                },
              }
            : { ok: true, data: read.data },
        latencyMs: 2,
      } as QToolCallOutcome;
      return Promise.resolve(outcome);
    },
  };
  const repositories = {
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
  } as unknown as QRuntimeRepositories;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
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
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [subject],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: {
      runId: RUN,
      tenantId: TENANT,
      actor: { userId: USER },
      purpose: {
        capability: "ANSWER",
        taskClass:
          subject.kind === "RELATIONSHIP"
            ? "RELATIONSHIP_QUESTION"
            : "COUNTERPARTY_COMPANY_QUESTION",
      },
      subjects: [subject],
      scopes: [
        {
          kind:
            subject.kind === "RELATIONSHIP"
              ? "RELATIONSHIP_CONTEXT"
              : "COMPANY_PROFILE",
          subject,
        },
      ],
      denied: [],
      // The test catalogue routes PUBLIC only, as the own-profile test does.
      maxSensitivity: "PUBLIC",
    } as unknown as PermittedContextPlan,
  } as unknown as QAnswerRequest;
  return { seam, request, alpha, executed };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("Home Q knows where the person stands with the counterparty", () => {
  it("reads the relationship for the company asked about and states it among the facts, in words, with dates", async () => {
    const { seam, request, alpha, executed } = build({
      status: "SUCCEEDED",
      data: CONNECTED,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => [call.name, call.arguments])).toEqual([
      ["get_relationship", { companyId: COMPANY }],
    ]);
    const sent = sentTo(alpha);
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain("own relationship with Kora on Capital Q");
    expect(facts).toContain("connected -- both sides have agreed to connect");
    expect(facts).toContain("interest expressed 2026-09-24");
    expect(facts).toContain("a first meeting is the natural next step");
    // Words, not a field dump.
    expect(facts).not.toContain("nextStep");
    expect(facts).not.toContain("SCHEDULE_MEETING");
  });

  it("reads a relationship subject by its id, for the founder's own side", async () => {
    const founderView = {
      ...CONNECTED,
      yourSide: "COMPANY",
      counterpart: {
        kind: "INVESTOR_ORGANISATION",
        id: INVESTOR,
        name: "Beacon Ventures",
      },
      relationship: {
        ...CONNECTED.relationship,
        // The company's fold: no private discovery.
        milestones: CONNECTED.relationship.milestones.slice(1),
      },
    };
    const { seam, request, alpha, executed } = build(
      { status: "SUCCEEDED", data: founderView },
      { kind: "RELATIONSHIP", relationshipId: RELATIONSHIP },
    );
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => [call.name, call.arguments])).toEqual([
      ["get_relationship", { relationshipId: RELATIONSHIP }],
    ]);
    const sent = sentTo(alpha);
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain("own relationship with Beacon Ventures");
    expect(facts).not.toContain("discovered 2026-09-20");
  });

  it("adds nothing when the read is refused, or when nothing is on record", async () => {
    for (const read of [
      { status: "DENIED" as const },
      {
        status: "SUCCEEDED" as const,
        data: { ...CONNECTED, relationship: null },
      },
    ]) {
      const { seam, request, alpha } = build(read);
      await seam.answer(request);
      expect(sentTo(alpha)).not.toContain("own relationship with");
    }
  });
});

describe("relationshipFact", () => {
  it("is verified platform history, dated, and never a state it does not know", () => {
    expect(relationshipFact(CONNECTED)).toMatchObject({
      scope: "RELATIONSHIP_CONTEXT",
      truthClass: "VERIFIED",
      evidenceStatus: "PLATFORM_VERIFIED",
      asOf: "2026-09-25",
    });
    expect(
      relationshipFact({
        ...CONNECTED,
        relationship: { ...CONNECTED.relationship, state: "MARRIED" },
      }),
    ).toBeNull();
  });
});
