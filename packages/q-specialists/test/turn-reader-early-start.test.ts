import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerOutcome,
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import type { QOpenRecordPort } from "../src/references.js";

/**
 * Reader latency (2026-11-06; live18: the turn reading was 3.9-4.9 s of a
 * 4.4-6.2 s first sentence). With no early reading in flight, the reading
 * starts as soon as its inputs exist -- beside the lanes that read the
 * database (a tab, a record or researched entity by name) -- not after
 * them. A lane that answers the turn stops it; the lanes decided by code
 * alone still make no reading at all (turn-latency.test.ts).
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
      purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
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

const QUESTION: QTurnReading = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
  answerKind: "LOOKUP",
};

/** A promise and its resolver, so the test decides when a lane's read lands. */
function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function seam(options: {
  readonly said: string;
  /** Their counterparts, read by the record-by-name lane (a database read). */
  readonly counterparts: Promise<readonly string[]>;
  readonly opens: QOpenRecordPort["open"];
}) {
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: randomUUID() as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role: "USER",
    content: options.said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
  const timeline: string[] = [];
  const readerSignals: AbortSignal[] = [];
  const answers: QAnswerRequest[] = [];
  const stored: string[] = [];
  const turns: QTurnReader = {
    read: (input) => {
      timeline.push("reading started");
      if (input.signal !== undefined) readerSignals.push(input.signal);
      return Promise.resolve(QUESTION);
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
      answer: (req): Promise<QAnswerOutcome> => {
        answers.push(req);
        stored.push("Answer.");
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([message]),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: { content: string }) => {
          stored.push(input.content);
          return Promise.resolve({
            ...message,
            id: randomUUID(),
            role: "Q",
            content: input.content,
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    counterpartNames: () =>
      options.counterparts.then((names) => {
        timeline.push("counterparts read");
        return names;
      }),
    openRecord: { open: options.opens },
  });
  return { answer, timeline, readerSignals, answers, stored };
}

describe("the turn reading starts beside the database lanes (reader latency)", () => {
  it("is under way before the record-by-name lane's read lands, and is the reading the answer takes", async () => {
    const counterparts = deferred<readonly string[]>();
    const run = seam({
      said: "Open Ledgerfold",
      counterparts: counterparts.promise,
      // Not one they can open: the lane falls through to the reading.
      opens: () => Promise.resolve(null),
    });
    const answering = run.answer.answer(request());
    // Let the turn reach the lane; its read is still outstanding.
    for (let i = 0; i < 20 && run.timeline.length === 0; i += 1) {
      await new Promise((settle) => setTimeout(settle, 1));
    }
    expect(run.timeline).toEqual(["reading started"]);
    counterparts.resolve([]);
    await answering;
    expect(run.timeline).toEqual(["reading started", "counterparts read"]);
    // One reading for the turn, never a second after the lanes.
    expect(run.readerSignals).toHaveLength(1);
  });

  it("is stopped when a database lane answers the turn", async () => {
    const run = seam({
      said: "Open Ledgerfold",
      counterparts: Promise.resolve(["Ledgerfold"]),
      opens: (_request, target) =>
        Promise.resolve({
          kind: "OPEN_RECORD_PAGE",
          page: target.page,
          id: "11111111-1111-4111-8111-111111111111",
        }),
    });
    await run.answer.answer(request());
    // Answered by the lane, with no model answer...
    expect(run.answers).toHaveLength(0);
    expect(run.stored.length).toBeGreaterThan(0);
    // ...and the reading begun beside it is not left running.
    expect(run.readerSignals).toHaveLength(1);
    expect(run.readerSignals[0]?.aborted).toBe(true);
  });
});
