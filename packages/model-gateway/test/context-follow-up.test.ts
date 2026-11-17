import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
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
  answerContextOf,
  CONTEXT_EVIDENCE_CHARS_MAX,
  createContextFollowUp,
  createConversationEvidence,
  evidenceScopeOf,
  keepAnswerContext,
  type ConversationEvidence,
} from "../src/q/index.js";
import { TENANT, testCatalog, USER } from "./fixtures.js";

/**
 * DECISIONS 104 (owner, 2026-11-17): "and their burn?" right after Q read
 * Tensorgate's figures is answered from what that answer was given, in
 * one tool-free call held to the claim check, and only for the same
 * person, access context and conversation while the evidence is fresh
 * and unchanged. Anything else misses, and the full path answers.
 */

const CONVERSATION = randomUUID();
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";

const FIGURES =
  "Tensorgate (company record, management accounts): monthly burn USD 180,000; runway 14 months; raising USD 3,000,000 seed.";

function actorOf(userId: string): ActorContext {
  return ActorContextSchema.parse({
    userId,
    tenantId: TENANT,
    organisationId: ORG,
    actorType: "HUMAN",
  });
}

function planOf(
  userId: string,
  maxSensitivity = "CONFIDENTIAL",
): PermittedContextPlan {
  const runId = randomUUID();
  return PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId,
    tenantId: TENANT,
    actor: { userId, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity,
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
    revalidateOnResume: true,
  });
}

function requestFor(
  userId = USER,
  maxSensitivity = "CONFIDENTIAL",
): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId,
    tenantId: TENANT,
    actorUserId: userId,
    actor: actorOf(userId),
    correlationId: `cor_${runId}`,
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: planOf(userId, maxSensitivity),
  } as unknown as QAnswerRequest;
}

function message(role: "USER" | "Q", content: string): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: CONVERSATION,
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  } as unknown as QConversationMessage;
}

const latest = message("USER", "and their burn?");
const history = [
  message("USER", "tell me about Tensorgate's raise"),
  message("Q", "Tensorgate is raising a USD 3,000,000 seed round."),
  latest,
];
const input = {
  conversationId: CONVERSATION,
  history,
  latestId: latest.id,
  said: latest.content,
  spoken: true,
};

function setup(
  outputs: readonly unknown[],
  options: {
    readonly evidence?: ConversationEvidence;
    readonly duringCall?: () => void;
  } = {},
) {
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: outputs.map((output) => ({
      kind: "TEXT" as const,
      text: JSON.stringify(output),
    })),
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog((s) => s)),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
  });
  const evidence = options.evidence ?? createConversationEvidence();
  const during = options.duringCall;
  const watched =
    during === undefined
      ? gateway
      : {
          ...gateway,
          execute: ((request, executeOptions) => {
            during();
            return gateway.execute(request, executeOptions);
          }) as typeof gateway.execute,
        };
  const follow = createContextFollowUp({ gateway: watched, evidence });
  return { follow, alpha, evidence };
}

function keep(
  evidence: ConversationEvidence,
  request: QAnswerRequest,
  conversationId = CONVERSATION,
): void {
  keepAnswerContext(
    evidence,
    evidenceScopeOf({
      actor: request.actor,
      plan: request.plan,
      conversationId,
    }),
    "run-that-read",
    [FIGURES, "Halyard Security: mandate fit 10 out of 10."],
  );
}

const GROUNDED = {
  answerable: true,
  say: "Their monthly burn is USD 180,000, which their management accounts put at 14 months of runway.",
};

describe("the contextual follow-up fast path (DECISIONS 104)", () => {
  it("answers from the previous answer's sources in one tool-free call", async () => {
    const { follow, alpha, evidence } = setup([GROUNDED]);
    keep(evidence, requestFor());
    const outcome = await follow.answer(requestFor(), input);
    expect(outcome).toMatchObject({
      kind: "ANSWERED",
      readByRun: "run-that-read",
    });
    expect(outcome.kind === "ANSWERED" && outcome.text).toContain("180,000");
    expect(alpha.calls).toHaveLength(1);
    const call = alpha.calls[0]?.request;
    expect(call?.tools ?? []).toEqual([]);
    const prompt = (call?.messages ?? []).map((m) => m.content).join("\n");
    expect(prompt).toContain('<<<UNTRUSTED_CONTENT source="evidence">>>');
    expect(prompt).toContain("monthly burn USD 180,000");
    expect(prompt).toContain("spoken aloud");
  });

  it("is held to the claim check: a figure its sources lack sends the turn the full way", async () => {
    const { follow, evidence } = setup([
      {
        answerable: true,
        say: "Their monthly burn is USD 240,000, so about 9 months of runway.",
      },
    ]);
    keep(evidence, requestFor());
    expect(await follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "UNGROUNDED",
    });
  });

  it("misses when the sources do not hold the answer", async () => {
    const { follow, evidence } = setup([{ answerable: false, say: null }]);
    keep(evidence, requestFor());
    expect(await follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "NOT_ANSWERABLE",
    });
  });

  it("never reuses another person's, conversation's or access context's evidence (no call is made)", async () => {
    const other = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
    for (const [kept, asked, conversationId] of [
      [requestFor(other), requestFor(), CONVERSATION],
      [requestFor(), requestFor(), randomUUID()],
      [requestFor(USER, "INTERNAL"), requestFor(), CONVERSATION],
    ] as const) {
      const { follow, alpha, evidence } = setup([GROUNDED]);
      keep(evidence, kept, conversationId);
      expect(follow.holds(asked, CONVERSATION)).toBe(false);
      expect(await follow.answer(asked, input)).toEqual({
        kind: "MISS",
        reason: "NO_EVIDENCE",
      });
      expect(alpha.calls).toHaveLength(0);
    }
  });

  it("expires with its TTL and drops when the watermark reports a change", async () => {
    let clock = 1_000_000;
    const aged = createConversationEvidence({ now: () => clock });
    const one = setup([GROUNDED], { evidence: aged });
    keep(aged, requestFor());
    clock += 3 * 60_000 + 1;
    expect(await one.follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "NO_EVIDENCE",
    });
    expect(one.alpha.calls).toHaveLength(0);

    const changed = createConversationEvidence({
      watermark: () => Promise.resolve(true),
    });
    const two = setup([GROUNDED], { evidence: changed });
    keep(changed, requestFor());
    expect(await two.follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "NO_EVIDENCE",
    });
    expect(two.alpha.calls).toHaveLength(0);
  });

  it("a revocation while the model writes is not answered from the old evidence", async () => {
    const evidence = createConversationEvidence();
    const { follow } = setup([GROUNDED], {
      evidence,
      duringCall: () => {
        evidence.forgetPerson({ tenantId: TENANT, userId: USER });
      },
    });
    keep(evidence, requestFor());
    expect(await follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "REVOKED",
    });
  });

  it("a reply claiming work it did not do misses", async () => {
    const { follow, evidence } = setup([
      { answerable: true, say: "I've checked their accounts again: fine." },
    ]);
    keep(evidence, requestFor());
    expect(await follow.answer(requestFor(), input)).toEqual({
      kind: "MISS",
      reason: "CLAIMS_WORK",
    });
  });

  it("keeps sources bounded, deduplicated and in order", () => {
    const big = "x".repeat(20_000);
    const kept = answerContextOf(["a", "a", " ", big, "b", big, "c"]);
    expect(kept.sources[0]).toBe("a");
    expect(kept.sources[1]?.length).toBe(8_000);
    expect(kept.sources).toContain("b");
    expect(kept.sources.filter((s) => s.startsWith("x"))).toHaveLength(1);
    expect(kept.sources.join("\n").length).toBeLessThanOrEqual(
      CONTEXT_EVIDENCE_CHARS_MAX,
    );
  });
});
