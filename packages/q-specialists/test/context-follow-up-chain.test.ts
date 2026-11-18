import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import {
  CONVERSATION_EVIDENCE_TTL_MS,
  createContextFollowUp,
  createConversationEvidence,
  evidenceScopeOf,
  keepAnswerContext,
  type ConversationEvidence,
  type QTurnReader,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Live 18 Nov 2026 (fictional investor, conversation 9ec5e264, 00:43 UTC):
 * turn 2, "Why does that matter for an investor like me?", took the
 * contextual follow-up fast path; turn 3, "And what is the biggest risk in
 * that?", 14 s later, missed with NO_EVIDENCE and went the full way. Turn 2
 * had moved them to the company page, so turn 3's plan also permitted
 * COMPANY_PROFILE: its access key differed from the one turn 1's sources
 * were kept under. A chain of follow-ups is now answered from the same
 * sources until their TTL (from the original read), a write of theirs or
 * an access change that withdraws what they were read under. Stage counts
 * and an injected clock only; no wall-clock assertion.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

type ScopeKind = "INVESTOR_PROFILE" | "INVESTOR_MANDATE" | "COMPANY_PROFILE";

/** Turns 1 and 2 live (INVESTOR_QUESTION). */
const INVESTOR: readonly ScopeKind[] = ["INVESTOR_PROFILE", "INVESTOR_MANDATE"];
/** Turn 3 live, asked from the company page (COUNTERPARTY_COMPANY_QUESTION). */
const ON_COMPANY: readonly ScopeKind[] = [...INVESTOR, "COMPANY_PROFILE"];

function request(
  kinds: readonly ScopeKind[],
  maxSensitivity = "CONFIDENTIAL",
): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: ORG },
      purpose: {
        capability: "ANSWER",
        taskClass: kinds.includes("COMPANY_PROFILE")
          ? "COUNTERPARTY_COMPANY_QUESTION"
          : "INVESTOR_QUESTION",
      },
      subjects: [],
      scopes: kinds.map((kind) => ({
        kind,
        ...(kind === "COMPANY_PROFILE"
          ? { subject: { kind: "COMPANY", companyId: COMPANY } }
          : {}),
        contextLabel: "organisation_private",
        sensitivity: "CONFIDENTIAL",
        layer: "STRUCTURED_STATE",
        factCategories: [],
        projection: "FULL",
        rights: {
          canUseForReasoning: true,
          canDiscloseExistence: true,
          canQuote: true,
          canProvideLink: true,
        },
        filter: {
          tenantId: TENANT,
          ...(kind === "COMPANY_PROFILE" ? { companyId: COMPANY } : {}),
        },
        isEvidence: true,
      })),
      denied: [],
      maxSensitivity,
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date(0).toISOString(),
      revalidateAfter: new Date(60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

/** What turn 1's full answer was given (its claim-check sources). */
const SOURCES = [
  "Halyard Security (company record): annual recurring revenue USD 1,200,000; 14 enterprise customers; raising USD 4,000,000 Series A.",
  "Halyard Security (deck): the largest customer is 31% of revenue.",
];
const FULL_ANSWER =
  "Halyard Security has USD 1,200,000 of annual recurring revenue across 14 enterprise customers and is raising USD 4,000,000.";
const WHY =
  "It matters because 14 enterprise customers at USD 1,200,000 of recurring revenue show demand, which is what a Series A investor like you needs to see.";
const RISK =
  "The biggest risk is concentration: the largest customer is 31% of revenue, so losing it would cut recurring revenue sharply.";

/**
 * One conversation, turn by turn, through the real specialist seam: the
 * reader, the context follow-up (real, over the shared evidence store) and
 * a full path whose answer keeps its sources as the gateway does.
 */
function conversation(evidence: ConversationEvidence) {
  const conversationId = randomUUID();
  const messages: QConversationMessage[] = [];
  const counts = { reader: 0, fullAnswer: 0, context: 0 };
  const logged: { message: string; context: Record<string, unknown> }[] = [];
  const logger = {
    debug: () => undefined,
    info: (context: Record<string, unknown>, text: string) => {
      logged.push({ message: text, context });
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  const add = (role: "USER" | "Q", content: string) => {
    const stored = {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      role,
      content,
      contentType: "TEXT",
      createdAt: new Date(messages.length * 1_000).toISOString(),
    } as QConversationMessage;
    messages.push(stored);
    return stored;
  };
  let reply = WHY;
  const turns: QTurnReader = {
    read: () => {
      counts.reader += 1;
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: "" },
        answerKind: "FOLLOW_UP",
        fromShown: { turn: 1, reshow: false },
      } as never);
    },
  };
  const gateway = {
    execute: () => {
      counts.context += 1;
      return Promise.resolve({
        output: { kind: "STRUCTURED", value: { answerable: true, say: reply } },
      });
    },
  } as unknown as ModelGateway;
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      answer: (asked) => {
        counts.fullAnswer += 1;
        add("Q", FULL_ANSWER);
        // As the gateway does after its claim check (index.ts).
        keepAnswerContext(
          evidence,
          evidenceScopeOf({ actor, plan: asked.plan, conversationId }),
          asked.runId,
          SOURCES,
        );
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...messages]),
        mark: () => Promise.resolve(),
        insert: (
          _tx: unknown,
          row: Omit<QConversationMessage, "id" | "createdAt">,
        ) => Promise.resolve(add("Q", row.content)),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    logger,
    conversationRecall: () => Promise.resolve(null),
    contextFollowUp: createContextFollowUp({ gateway, evidence, logger }),
  });
  /** Ask one turn; return its stage counts and the fast path's outcome. */
  const ask = async (
    said: string,
    asked: QAnswerRequest,
    say: string = WHY,
  ) => {
    reply = say;
    const before = { ...counts };
    const seen = logged.length;
    add("USER", said);
    const outcome = await answer.answer(asked);
    expect(outcome.kind).toBe("ANSWERED");
    const lines = logged.slice(seen);
    const followUp = lines.find(
      (line) => line.message === "q context follow-up",
    )?.context;
    const reused = lines.find(
      (line) =>
        line.message ===
        "q answered a follow-up from this conversation's evidence",
    )?.context;
    return {
      fullAnswer: counts.fullAnswer - before.fullAnswer,
      context: counts.context - before.context,
      reader: counts.reader - before.reader,
      followUp: followUp ?? null,
      /** The run whose sources the fast path answered from. */
      readByRun: reused?.["readByRun"] ?? null,
      said: messages.at(-1)?.content,
    };
  };
  return { ask, conversationId };
}

function clocked() {
  const clock = { at: 1_000_000 };
  const evidence = createConversationEvidence({ now: () => clock.at });
  return { clock, evidence };
}

describe("a chain of contextual follow-ups (live 18 Nov, 9ec5e264)", () => {
  it("full, then fast, then fast: no full answer on turns 2 and 3, though turn 3 is asked from the company page", async () => {
    const { clock, evidence } = clocked();
    const chat = conversation(evidence);

    const first = request(INVESTOR);
    const one = await chat.ask(
      "What does Halyard Security do and how is it doing commercially?",
      first,
    );
    expect(one).toMatchObject({ fullAnswer: 1, context: 0 });

    clock.at += 8_000;
    const two = await chat.ask(
      "Why does that matter for an investor like me?",
      request(INVESTOR),
      WHY,
    );
    expect(two).toMatchObject({
      fullAnswer: 0,
      context: 1,
      reader: 1,
      said: WHY,
      readByRun: first.runId,
    });
    expect(two.followUp).toMatchObject({ outcome: "ANSWERED" });

    clock.at += 14_000;
    const three = await chat.ask(
      "And what is the biggest risk in that?",
      request(ON_COMPANY),
      RISK,
    );
    expect(three).toMatchObject({
      fullAnswer: 0,
      context: 1,
      reader: 1,
      said: RISK,
      // The same sources turn 1 read, carried through turn 2 unchanged.
      readByRun: first.runId,
    });
    expect(three.followUp).toMatchObject({ outcome: "ANSWERED" });
  });

  it("the carried sources expire at the original read time plus the TTL: turn 2 never refreshes them", async () => {
    const { clock, evidence } = clocked();
    const chat = conversation(evidence);
    await chat.ask("How is Halyard doing?", request(INVESTOR));

    // Turn 2 two minutes after the read: answered from it.
    clock.at += 2 * 60_000;
    const two = await chat.ask("Why does that matter?", request(INVESTOR));
    expect(two).toMatchObject({ fullAnswer: 0, context: 1 });

    // Turn 3 just inside the original TTL: still answered from it.
    clock.at += CONVERSATION_EVIDENCE_TTL_MS - 2 * 60_000;
    const three = await chat.ask(
      "And the biggest risk?",
      request(INVESTOR),
      RISK,
    );
    expect(three).toMatchObject({ fullAnswer: 0, context: 1 });

    // One millisecond past the original read + TTL: dropped, although
    // turns 2 and 3 used it well inside a fresh TTL of their own.
    clock.at += 1;
    const four = await chat.ask(
      "And what would change your mind?",
      request(INVESTOR),
    );
    expect(four).toMatchObject({ fullAnswer: 1, context: 0 });
    expect(four.followUp).toMatchObject({
      outcome: "MISS",
      reason: "NO_EVIDENCE",
    });
  });

  it("an access change between turns 2 and 3 forces a miss: no call, the full path answers", async () => {
    for (const changed of [
      // A scope the sources were read under is withdrawn (a revoked grant).
      request(["INVESTOR_PROFILE"]),
      // The run's ceiling changed.
      request(INVESTOR, "INTERNAL"),
    ]) {
      const { clock, evidence } = clocked();
      const chat = conversation(evidence);
      await chat.ask("How is Halyard doing?", request(INVESTOR));
      clock.at += 5_000;
      expect(
        await chat.ask("Why does that matter?", request(INVESTOR)),
      ).toMatchObject({ fullAnswer: 0, context: 1 });
      clock.at += 5_000;
      const three = await chat.ask("And the biggest risk?", changed, RISK);
      expect(three).toMatchObject({ fullAnswer: 1, context: 0 });
      expect(three.followUp).toMatchObject({
        outcome: "MISS",
        reason: "NO_EVIDENCE",
      });
    }
  });

  it("a write of theirs between turns drops the carried sources", async () => {
    const { clock, evidence } = clocked();
    const chat = conversation(evidence);
    await chat.ask("How is Halyard doing?", request(INVESTOR));
    clock.at += 5_000;
    await chat.ask("Why does that matter?", request(INVESTOR));
    evidence.forgetPerson({ tenantId: TENANT, userId: USER });
    const three = await chat.ask("And the biggest risk?", request(INVESTOR));
    expect(three).toMatchObject({ fullAnswer: 1, context: 0 });
  });

  it("a full answer under a narrower grant replaces the carried sources; a wider one may not use them", async () => {
    const { clock, evidence } = clocked();
    const chat = conversation(evidence);
    // Turn 1 read on the company page (wider); turn 2 asked without it.
    await chat.ask("How is Halyard doing?", request(ON_COMPANY));
    clock.at += 5_000;
    const narrower = request(INVESTOR);
    const two = await chat.ask("Why does that matter?", narrower);
    expect(two).toMatchObject({ fullAnswer: 1, context: 0 });
    // Turn 2's full answer replaced them, read under INVESTOR: turn 3 on
    // the company page is covered by it and answers from turn 2's sources,
    // never turn 1's.
    clock.at += 5_000;
    const three = await chat.ask(
      "And the biggest risk?",
      request(ON_COMPANY),
      RISK,
    );
    expect(three).toMatchObject({
      fullAnswer: 0,
      context: 1,
      readByRun: narrower.runId,
    });
  });
});
