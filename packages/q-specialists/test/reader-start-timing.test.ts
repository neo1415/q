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
  QPrereadInput,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * When the turn's own reading starts (voice audit Phase 3, live 16 Nov
 * 2026 on 77187e4aa, investor Savanna, conversation db74c76d).
 *
 * The answer waits for one call: the turn reader. Its skims run beside it
 * and the arrival skim gets 250 ms of grace; nothing else blocks. What the
 * turn's own reading still waited for before it was asked was its
 * situation header (the person's own records, read through the database):
 * 0.41 s on turn 1 (no early reading: the first turn this process read
 * for them) and 0.19 s on turn 2 (the early reading was dropped, its
 * actions having changed with the page). The early reading had already
 * built the same header at message receipt, a second earlier.
 *
 * Virtual clock; latencies from production:
 *   firewall and plan before the answer   1,000 ms (turn 1: 1.07 s)
 *   the situation read                       190 ms (turn 2)
 *   the turn reader                     the turn reader's warm first
 *     attempts on 16 Nov from ai_ops.model_usage (input ~23-25k tokens,
 *     output 153-262; its time follows its output, ~4.7 ms a token).
 */

const FIREWALL_MS = 1_000;
const SITUATION_MS = 190;
const READER_MS = [2_227, 2_265, 2_312, 2_390, 2_812, 2_975, 3_016] as const;
const TARGET_P50_MS = 2_500;

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * One turn as the orchestrator drives it: the early read at message
 * receipt, the firewall, then the answer. Returns when the turn's reading
 * was asked and when it was done, from the answer's start.
 */
async function oneTurn(input: {
  readonly readerMs: number;
  readonly prereadScreen?: QPrereadInput["situationScreen"];
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
  let answerStartedAt = 0;
  const readings: { askedMs: number; doneMs: number; situation: string }[] = [];
  let situationReads = 0;
  const turns: QTurnReader = {
    read: async (asked) => {
      const askedMs = Date.now() - answerStartedAt;
      await wait(input.readerMs);
      readings.push({
        askedMs,
        doneMs: Date.now() - answerStartedAt,
        situation: asked.situation ?? "",
      });
      return {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "THEIR_OWN_RECORDS", text: "x" },
        fromShown: null,
      } as never;
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
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    situationOf: async () => {
      situationReads += 1;
      await wait(SITUATION_MS);
      return null;
    },
  });
  const asked = request();
  answer.preread?.({
    runId: asked.runId,
    tenantId: asked.tenantId,
    actor: asked.actor,
    correlationId: asked.correlationId,
    ...(input.prereadScreen === undefined
      ? {}
      : { situationScreen: input.prereadScreen }),
  });
  await wait(FIREWALL_MS);
  answerStartedAt = Date.now();
  await answer.answer(asked);
  const reading = readings[0];
  if (reading === undefined) throw new Error("the turn was not read");
  return { ...reading, readings: readings.length, situationReads };
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

const p50 = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN;
};

describe("the turn's reading starts when the turn does", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a first turn (no early reading): asked at once, reader-done p50 within 2.5 s", async () => {
    const turns = [];
    for (const readerMs of READER_MS) {
      turns.push(await onVirtualClock(() => oneTurn({ readerMs })));
    }
    const done = turns.map((turn) => turn.doneMs);
    console.info(
      `reader asked at ${turns.map((turn) => turn.askedMs).join(", ")} ms; done ${done.join(", ")} ms; p50 ${String(p50(done))} ms`,
    );
    for (const turn of turns) {
      // The header the early read began at message receipt is the one the
      // turn's reading is given: built once, never waited for again.
      expect(turn.askedMs).toBeLessThan(20);
      expect(turn.situationReads).toBe(1);
      expect(turn.readings).toBe(1);
    }
    expect(p50(done)).toBeLessThanOrEqual(TARGET_P50_MS);
  });

  it("a header built for another screen than the plan's is built again", async () => {
    // The early read's screen came before the firewall; the reading is
    // told only what the plan kept (here: no page at all).
    const turn = await onVirtualClock(() =>
      oneTurn({ readerMs: 2_000, prereadScreen: { route: "DISCOVER" } }),
    );
    expect(turn.situationReads).toBe(2);
    expect(turn.situation).toContain("Page: unknown.");
    expect(turn.askedMs).toBeGreaterThanOrEqual(SITUATION_MS);
  });
});
