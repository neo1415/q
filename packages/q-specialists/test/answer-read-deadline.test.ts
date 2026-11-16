import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import { TURN_READ_DEADLINE_MS } from "../src/bounded-read.js";

/**
 * The reads the turn reader waits for are bounded (16 Nov 2026).
 *
 * On the transaction-pooler trial run dff4faca hung after its skim: the
 * reader awaited the situation and conversation-state reads, one never
 * returned, and nothing timed it out. Now, past TURN_READ_DEADLINE_MS, the
 * turn is read without that read (as when it fails), and the log says so.
 *
 * Virtual clock: a read that never settles, and the deadline's timer.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function request(): QAnswerRequest {
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
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

function message(
  conversationId: string,
  role: "USER" | "Q",
  content: string,
): QConversationMessage {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    conversationId,
    runId: randomUUID(),
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  } as QConversationMessage;
}

async function oneTurn(input: {
  readonly situationHangs: boolean;
  readonly stateHangs: boolean;
}) {
  const conversationId = randomUUID();
  const history = [
    message(conversationId, "USER", "hello"),
    message(conversationId, "Q", "Hello. What would you like to look at?"),
    message(
      conversationId,
      "USER",
      "how is Tensorgate's revenue trending against its plan?",
    ),
  ];
  const startedAt = Date.now();
  const readings: {
    askedMs: number;
    situation: string;
    state: string | undefined;
  }[] = [];
  const warnings: string[] = [];
  const turns: QTurnReader = {
    read: (asked) => {
      readings.push({
        askedMs: Date.now() - startedAt,
        situation: asked.situation ?? "",
        state: asked.conversationState,
      });
      return Promise.resolve({
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "THEIR_OWN_RECORDS", text: "x" },
        fromShown: null,
      } as never);
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      answer: () =>
        Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        }),
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...history]),
        mark: () => Promise.resolve(),
        insert: (
          _tx: unknown,
          row: Omit<QConversationMessage, "id" | "createdAt">,
        ) =>
          Promise.resolve({
            ...row,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          }),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
      // The stored conversation state: a read that never returns.
      conversationStates: {
        find: () => (input.stateHangs ? never() : Promise.resolve(null)),
        latestSummary: () =>
          input.stateHangs ? never() : Promise.resolve(null),
        save: () => Promise.resolve(true),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    situationOf: () =>
      input.situationHangs
        ? never()
        : Promise.resolve({
            displayName: "Ada",
            role: "INVESTOR",
            organisation: "Savanna Seed",
          } as never),
    logger: {
      warn: (_fields: unknown, line: string) => warnings.push(line),
      debug: () => undefined,
      info: () => undefined,
      error: () => undefined,
    } as never,
  });
  await answer.answer(request());
  const reading = readings[0];
  if (reading === undefined) throw new Error("the turn was not read");
  return { ...reading, warnings };
}

async function onVirtualClock<T>(work: () => Promise<T>): Promise<T> {
  let settled = false;
  const running = work().finally(() => {
    settled = true;
  });
  for (let step = 0; !settled && step < 200_000; step += 1) {
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersToNextTimerAsync();
    } else {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return running;
}

describe("the reads before the turn reader are bounded", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 5 s at most", () => {
    expect(TURN_READ_DEADLINE_MS).toBe(5_000);
  });

  it("a situation read that never returns: the turn is read at the deadline, the asker unknown", async () => {
    const turn = await onVirtualClock(() =>
      oneTurn({ situationHangs: true, stateHangs: false }),
    );
    expect(turn.askedMs).toBeGreaterThanOrEqual(TURN_READ_DEADLINE_MS);
    expect(turn.askedMs).toBeLessThan(TURN_READ_DEADLINE_MS + 1_000);
    expect(turn.situation).toContain("Asking: name unknown, role unknown.");
    expect(turn.warnings).toContain(
      "the situation was not read in time; reading the turn without it",
    );
  });

  it("a conversation-state read that never returns: the turn is read from history alone", async () => {
    const turn = await onVirtualClock(() =>
      oneTurn({ situationHangs: false, stateHangs: true }),
    );
    expect(turn.askedMs).toBeGreaterThanOrEqual(TURN_READ_DEADLINE_MS);
    expect(turn.askedMs).toBeLessThan(TURN_READ_DEADLINE_MS + 1_000);
    expect(turn.state).toBeUndefined();
    expect(turn.situation).toContain("Asking: Ada");
    expect(turn.warnings).toContain(
      "the conversation state was not read; reading the turn from history alone",
    );
  });

  it("reads that answer are waited for as before", async () => {
    const turn = await onVirtualClock(() =>
      oneTurn({ situationHangs: false, stateHangs: false }),
    );
    expect(turn.askedMs).toBeLessThan(100);
    expect(turn.situation).toContain("Asking: Ada");
    expect(turn.warnings).toEqual([]);
  });
});
