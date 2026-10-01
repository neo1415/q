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
import { ownStandingFact } from "../src/q/own-standing.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * Q always knows who it is talking to (founder report 2026-10-01: on
 * Discover, "am I interested in this company?" was answered "I don't
 * know" a minute after the investor had saved and passed on it). Their
 * own standing is read through list_my_relationships on every turn and
 * placed among the facts, the on-screen company's line first; and the
 * guidance tells Q to answer the question behind a "no".
 */

const RUN = randomUUID();
const CONVERSATION = randomUUID();
const COMPANY = randomUUID();
const RELATIONSHIP = randomUUID();

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

const STANDING_TOOL: QOfferedTool = {
  ...RELATIONSHIP_TOOL,
  toolName: "relationship.list_mine",
  definition: {
    name: "list_my_relationships",
    description: "The person's own relationships, saves and passes.",
    inputJsonSchema: { type: "object", properties: {} },
  },
};

const OTHER = randomUUID();
const STANDING = {
  yourSide: "INVESTOR",
  relationships: [
    {
      relationshipId: RELATIONSHIP,
      counterpart: { kind: "COMPANY", id: OTHER, name: "Kora" },
      state: "INTEREST_EXPRESSED",
      stateSince: "2026-09-24T10:00:00.000Z",
      milestones: [],
      nextStep: "AWAIT_ANSWER",
    },
  ],
  saved: [{ companyId: OTHER, name: "Kora", stageCode: null }],
  passed: [{ companyId: COMPANY, name: "Ajopot", stageCode: null }],
  truthClass: "VERIFIED",
  source: "Capital Q relationship history",
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
  const inFlight = { now: 0, max: 0 };
  const tools: QToolPort = {
    offer: () => Promise.resolve([RELATIONSHIP_TOOL, STANDING_TOOL]),
    execute: async (proposal) => {
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight.now -= 1;
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
            : {
                ok: true,
                data:
                  proposal.name === "list_my_relationships"
                    ? STANDING
                    : read.data,
              },
        latencyMs: 2,
      } as QToolCallOutcome;
      return outcome;
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
  return { seam, request, alpha, executed, inFlight };
}

const sentTo = (alpha: ReturnType<typeof build>["alpha"]) =>
  alpha.calls
    .flatMap((call) => call.request.messages.map((m) => m.content))
    .join("\n");

describe("Q knows who it is talking to", () => {
  it("reads their own standing on a turn about a company and states the on-screen company's line first", async () => {
    // No relationship row with the on-screen company: only a pass.
    const { seam, request, alpha, executed } = build({
      status: "SUCCEEDED",
      data: { ...CONNECTED, relationship: null },
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(executed.map((call) => call.name).sort()).toEqual([
      "get_relationship",
      "list_my_relationships",
    ]);
    const sent = sentTo(alpha);
    const facts = sent.slice(sent.indexOf("AUTHORISED FACTS"));
    expect(facts).toContain(
      "About Ajopot: no interest expressed and no relationship yet; passed on in Discover.",
    );
    expect(facts).toContain("interest expressed, awaiting an answer: Kora");
    expect(facts).toContain("Saved in Discover: Kora.");
    // The guidance: answer the question behind a "no", and do the
    // expressive thing asked for rather than an emoji.
    expect(sent).toContain("ANSWER WHAT THEY MEAN");
    expect(sent).toContain("never a bare emoji");
  });
});

describe("the reads before the model run side by side", () => {
  // Speed sweep 2026-10-01: one after another they took ~0.6 s of the
  // wait before the model was asked anything.
  it("reads the relationship and their own standing at the same time", async () => {
    const { seam, request, inFlight } = build({
      status: "SUCCEEDED",
      data: CONNECTED,
    });
    expect((await seam.answer(request)).kind).toBe("ANSWERED");
    expect(inFlight.max).toBeGreaterThanOrEqual(2);
  });
});

describe("ownStandingFact", () => {
  it("says what is on record for the focus and never turns a save into interest", () => {
    const fact = ownStandingFact(STANDING, OTHER);
    expect(fact?.statement).toContain(
      "About Kora: they have expressed interest and are awaiting the answer; saved in Discover (a save is not interest).",
    );
  });

  it("states a founder's side without investor-only buckets", () => {
    const fact = ownStandingFact(
      {
        yourSide: "COMPANY",
        relationships: [],
        saved: [],
        passed: [],
      },
      null,
    );
    expect(fact?.statement).toContain(
      "No investor has expressed interest in their company yet.",
    );
    expect(fact?.statement).not.toContain("Saved in Discover");
  });

  it("bounds a long pipeline and adds nothing for a person on neither side", () => {
    const many = Array.from({ length: 30 }, (_, n) => ({
      companyId: randomUUID(),
      name: `Co${String(n)}`,
      stageCode: null,
    }));
    const fact = ownStandingFact(
      { ...STANDING, saved: many, passed: [] },
      null,
    );
    expect(fact?.statement).toContain("and 22 more");
    expect(
      ownStandingFact(
        { yourSide: "NONE", relationships: [], saved: [], passed: [] },
        null,
      ),
    ).toBeNull();
  });
});
