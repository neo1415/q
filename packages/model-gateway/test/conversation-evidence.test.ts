import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QAccountDigestSchema,
  type QAccountDigest,
  type TurnExecutionClass,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
  QToolPort,
} from "@capital-q/q-runtime";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import {
  CONVERSATION_EVIDENCE_TTL_MS,
  createConversationEvidence,
  createModelGatewayQAnswer,
  evidenceScopeOf,
  type ConversationEvidence,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * RC3 (Q voice audit, 15 Nov 2026): a short contextual follow-up is answered
 * from this conversation's evidence -- never another actor's, tenant's,
 * conversation's or authority's, never after a write, never stale -- and the
 * answer's concise spoken form rides the completion event only when it adds
 * nothing to the full answer. Fake model; no provider, no network.
 */

const NOW = new Date("2026-11-15T10:00:00.000Z");
const OTHER_TENANT = "7e0e0e0e-0000-4000-8000-000000000002";
const OTHER_USER = "7e0e0e0e-0000-4000-8000-000000000003";

function planFor(
  runId: string,
  tenantId: string,
  userId: string,
  maxSensitivity = "PUBLIC",
) {
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId,
    actor: { userId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity,
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: NOW.toISOString(),
    revalidateAfter: new Date(NOW.getTime() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

function actorOf(tenantId: string, userId: string): ActorContext {
  return ActorContextSchema.parse({ userId, tenantId, actorType: "HUMAN" });
}

describe("conversation evidence: isolation and invalidation", () => {
  const conversationId = randomUUID();
  const scopeFor = (
    tenantId: string,
    userId: string,
    conversation = conversationId,
    maxSensitivity = "PUBLIC",
  ) =>
    evidenceScopeOf({
      actor: actorOf(tenantId, userId),
      plan: planFor(randomUUID(), tenantId, userId, maxSensitivity),
      conversationId: conversation,
    });

  it("serves the same actor, tenant, conversation and access context", async () => {
    const evidence = createConversationEvidence();
    evidence.keep(
      scopeFor(TENANT, USER),
      "DIGEST",
      { kept: 1 },
      {
        runId: "run-1",
        reads: ["account.digest"],
      },
    );
    const kept = await evidence.take<{ kept: number }>(
      scopeFor(TENANT, USER),
      "DIGEST",
    );
    expect(kept?.value).toEqual({ kept: 1 });
    // Provenance: the run and the reads that produced it.
    expect(kept?.provenance).toEqual({
      runId: "run-1",
      reads: ["account.digest"],
    });
  });

  it("never serves another actor, tenant, conversation or access context", async () => {
    const evidence = createConversationEvidence();
    evidence.keep(
      scopeFor(TENANT, USER),
      "DIGEST",
      { kept: 1 },
      {
        runId: "run-1",
        reads: [],
      },
    );
    expect(await evidence.take(scopeFor(TENANT, OTHER_USER), "DIGEST")).toBe(
      null,
    );
    expect(await evidence.take(scopeFor(OTHER_TENANT, USER), "DIGEST")).toBe(
      null,
    );
    expect(
      await evidence.take(scopeFor(TENANT, USER, randomUUID()), "DIGEST"),
    ).toBe(null);
    // Another access context (here a different ceiling; a revoked or added
    // grant changes the plan's scopes the same way) is another authority.
    expect(
      await evidence.take(
        scopeFor(TENANT, USER, conversationId, "CONFIDENTIAL"),
        "DIGEST",
      ),
    ).toBe(null);
    // Another slot is another read.
    expect(await evidence.take(scopeFor(TENANT, USER), "WIDE")).toBe(null);
    // And the owner's own evidence is still there.
    expect(await evidence.take(scopeFor(TENANT, USER), "DIGEST")).not.toBe(
      null,
    );
  });

  it("drops it after a write of theirs, after the TTL, or when the watermark moved", async () => {
    let clock = NOW.getTime();
    let changed = false;
    const evidence = createConversationEvidence({
      now: () => clock,
      watermark: () => Promise.resolve(changed),
    });
    const keep = () =>
      evidence.keep(
        scopeFor(TENANT, USER),
        "WIDE",
        { kept: 1 },
        {
          runId: "r",
          reads: [],
        },
      );
    keep();
    evidence.forgetPerson({ tenantId: TENANT, userId: USER });
    expect(await evidence.take(scopeFor(TENANT, USER), "WIDE")).toBe(null);

    keep();
    // Another person's write never drops theirs.
    evidence.forgetPerson({ tenantId: TENANT, userId: OTHER_USER });
    expect(await evidence.take(scopeFor(TENANT, USER), "WIDE")).not.toBe(null);

    clock += CONVERSATION_EVIDENCE_TTL_MS + 1;
    expect(evidence.holds(scopeFor(TENANT, USER), "WIDE")).toBe(false);
    expect(await evidence.take(scopeFor(TENANT, USER), "WIDE")).toBe(null);

    keep();
    changed = true;
    expect(await evidence.take(scopeFor(TENANT, USER), "WIDE")).toBe(null);
  });

  it("treats a watermark that cannot answer as a change", async () => {
    const evidence = createConversationEvidence({
      watermark: () => Promise.reject(new Error("database unavailable")),
    });
    evidence.keep(
      scopeFor(TENANT, USER),
      "DIGEST",
      { kept: 1 },
      {
        runId: "r",
        reads: [],
      },
    );
    expect(await evidence.take(scopeFor(TENANT, USER), "DIGEST")).toBe(null);
  });
});

/** A small account digest; its read is what a follow-up must not repeat. */
function digest(): QAccountDigest {
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
    readAt: NOW.toISOString(),
  });
}

function seamWith(input: {
  readonly evidence: ConversationEvidence;
  readonly answers: readonly Record<string, unknown>[];
}) {
  const conversationId = randomUUID();
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: input.answers.map((value) => ({ kind: "JSON" as const, value })),
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
  const messages: QConversationMessage[] = [];
  const events: unknown[] = [];
  const say = (runId: string, content: string) => {
    messages.push({
      id: randomUUID(),
      tenantId: TENANT as QConversationMessage["tenantId"],
      conversationId: conversationId as QConversationMessage["conversationId"],
      runId: runId as QConversationMessage["runId"],
      role: "USER",
      content,
      contentType: "TEXT",
      createdAt: NOW.toISOString(),
    } as QConversationMessage);
  };
  const repositories = {
    messages: {
      listForRun: () => Promise.resolve([...messages]),
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      insert: (_tx: unknown, row: { role: "Q"; content: string }) => {
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
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: {
      append: (_tx: unknown, event: unknown) => {
        events.push(event);
        return Promise.resolve({});
      },
    },
  } as unknown as QRuntimeRepositories;
  const tools: QToolPort = {
    offer: () => Promise.resolve([]),
    execute: () => Promise.reject(new Error("no tool is offered")),
  };
  let digestReads = 0;
  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    tools,
    accountDigestOf: () => {
      digestReads += 1;
      return Promise.resolve(digest());
    },
    conversationEvidence: input.evidence,
    now: () => NOW,
  });
  const turn = async (
    words: string,
    executionClass: TurnExecutionClass | undefined,
    who: { tenantId: string; userId: string } = {
      tenantId: TENANT,
      userId: USER,
    },
  ) => {
    const runId = randomUUID();
    say(runId, words);
    const modelCallsBefore = alpha.calls.length;
    const result = await seam.answer({
      runId,
      tenantId: who.tenantId,
      actorUserId: who.userId,
      actor: actorOf(who.tenantId, who.userId),
      correlationId: `cor_${runId}`,
      capability: "ANSWER",
      subjects: [],
      retrieval: { kind: "NOT_CONFIGURED" },
      plan: planFor(runId, who.tenantId, who.userId),
      ...(executionClass === undefined ? {} : { executionClass }),
    } as unknown as QAnswerRequest);
    return { result, modelCalls: alpha.calls.length - modelCallsBefore };
  };
  const completed = () =>
    events
      .map(
        (event) =>
          event as {
            eventType?: string;
            payload?: { message?: { text?: string; spoken?: unknown } };
          },
      )
      .filter((event) => event.eventType === "q.message.completed")
      .map((event) => event.payload?.message);
  return { turn, completed, digestReads: () => digestReads };
}

const ANALYSIS = {
  answer:
    "Tensorgate is the strongest fit: it reports $4m ARR (self-reported) and sells to mid-market insurers. The main risk is concentration: two customers make up 40% of revenue.",
  responseShape: "ANALYTICAL",
  insufficientEvidence: false,
  recommendation: null,
};

describe("a short contextual follow-up through the answer seam", () => {
  it("is answered from the previous turn's evidence with one model call and no re-read", async () => {
    const { turn, digestReads } = seamWith({
      evidence: createConversationEvidence(),
      answers: [ANALYSIS, { ...ANALYSIS, answer: "Because of concentration." }],
    });
    const first = await turn(
      "Which of my matches fits best?",
      "COMPLEX_ANALYSIS",
    );
    expect(first.result.kind).toBe("ANSWERED");
    expect(digestReads()).toBe(1);
    const followUp = await turn("why?", "CONTEXTUAL_FOLLOW_UP");
    expect(followUp.result.kind).toBe("ANSWERED");
    expect(followUp.modelCalls).toBe(1);
    // The account digest was not read again.
    expect(digestReads()).toBe(1);
  });

  it("reads again on a turn whose class does not reuse evidence", async () => {
    const { turn, digestReads } = seamWith({
      evidence: createConversationEvidence(),
      answers: [ANALYSIS, ANALYSIS],
    });
    await turn("Which of my matches fits best?", "COMPLEX_ANALYSIS");
    await turn("Now analyse Shiftwell in depth.", "COMPLEX_ANALYSIS");
    expect(digestReads()).toBe(2);
  });

  it("reads again after a write of theirs", async () => {
    const evidence = createConversationEvidence();
    const { turn, digestReads } = seamWith({
      evidence,
      answers: [ANALYSIS, ANALYSIS],
    });
    await turn("Which of my matches fits best?", "COMPLEX_ANALYSIS");
    evidence.forgetPerson({ tenantId: TENANT, userId: USER });
    await turn("why?", "CONTEXTUAL_FOLLOW_UP");
    expect(digestReads()).toBe(2);
  });

  it("never serves one actor's evidence to another actor in the same conversation", async () => {
    const { turn, digestReads } = seamWith({
      evidence: createConversationEvidence(),
      answers: [ANALYSIS, ANALYSIS],
    });
    await turn("Which of my matches fits best?", "COMPLEX_ANALYSIS");
    await turn("why?", "CONTEXTUAL_FOLLOW_UP", {
      tenantId: TENANT,
      userId: OTHER_USER,
    });
    expect(digestReads()).toBe(2);
  });

  it("carries a spoken form that adds nothing, and drops one that adds a name", async () => {
    // No figure in the answer: an unsourced figure is replaced by Capital Q's
    // own line before it is stored (the figure guard), which is not this test.
    const answer =
      "Tensorgate is the strongest fit for your mandate, and Shiftwell is second. The main risk for Tensorgate is that two customers carry most of its sales, so concentration is the thing to test first.";
    const keptWords =
      "Tensorgate is the strongest fit, and Shiftwell is second. The main risk is concentration. The details are on your screen.";
    const { turn, completed } = seamWith({
      evidence: createConversationEvidence(),
      answers: [
        { ...ANALYSIS, answer, spoken: keptWords },
        {
          ...ANALYSIS,
          answer,
          spoken: "Halyard Security is the strongest fit.",
        },
      ],
    });
    await turn("Which of my matches fits best?", "COMPLEX_ANALYSIS");
    const first = completed();
    await turn("And which one should I look at first?", "COMPLEX_ANALYSIS");
    const second = completed().slice(first.length);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    for (const message of first) {
      expect(message?.text).toContain("Tensorgate is the strongest fit");
      expect(message?.spoken).toEqual({ version: 1, text: keptWords });
    }
    for (const message of second) {
      expect(message?.text).toContain("Tensorgate is the strongest fit");
      expect(message?.spoken).toBeUndefined();
    }
  });
});
