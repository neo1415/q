import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import {
  boundedCoreSnapshot,
  CORE_SNAPSHOT_MAX_CHARS,
  readCoreSnapshot,
  type ConversationCoreStore,
} from "../src/conversation-core.js";

/**
 * RECOVERY-2026-10 B3 (audit B-02): the conversation core's state survives
 * a deploy or another q-api instance. Two seams over one store stand for
 * "before" and "after" a restart.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();

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
      purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
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

const UNCLEAR = {
  kind: "UNCLEAR_TRANSCRIPT",
  confidence: "LOW",
  transcript: "NOISY",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

/** A store like the conversation row: one JSON value per conversation. */
function rowStore(options: { readonly failing?: boolean } = {}) {
  const rows = new Map<string, string>();
  const store: ConversationCoreStore = {
    load: (scope) =>
      options.failing === true
        ? Promise.reject(new Error("column missing"))
        : Promise.resolve(
            rows.has(scope.conversationId)
              ? (JSON.parse(
                  rows.get(scope.conversationId) ?? "null",
                ) as unknown)
              : null,
          ),
    save: (scope, snapshot) => {
      if (options.failing === true) {
        return Promise.reject(new Error("column missing"));
      }
      rows.set(scope.conversationId, JSON.stringify(snapshot));
      return Promise.resolve();
    },
  };
  return { store, rows };
}

/** One q-api process: its own memory, the shared messages and store. */
function instance(
  lines: QConversationMessage[],
  store: ConversationCoreStore | undefined,
) {
  const turns: QTurnReader = { read: () => Promise.resolve(UNCLEAR) };
  return createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: () => Promise.reject(new Error("no model for unclear turns")),
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          lines.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    ...(store === undefined ? {} : { coreState: store }),
  });
}

function spoken(lines: QConversationMessage[], said: string): void {
  lines.push({
    id: randomUUID(),
    tenantId: TENANT,
    conversationId: CONVERSATION,
    runId: randomUUID(),
    role: "USER",
    content: said,
    contentType: "TEXT",
    utteranceRef: `utt_${randomUUID()}`,
    createdAt: new Date().toISOString(),
  } as unknown as QConversationMessage);
}

const qLines = (lines: readonly QConversationMessage[]) =>
  lines.filter((line) => line.role === "Q").map((line) => line.content);

describe("the conversation core across a restart (B-02)", () => {
  it("keeps the unclear count: the turn after a deploy is not treated as the first", async () => {
    const lines: QConversationMessage[] = [];
    const { store } = rowStore();
    spoken(lines, "Fidiani inanituma attention");
    await instance(lines, store).answer(request());
    // A deploy: a new process, same conversation and store.
    spoken(lines, "Fidiani inanituma");
    await instance(lines, store).answer(request());
    expect(qLines(lines)).toEqual([
      "Sorry, I didn't catch that. Say it again?",
      "I still couldn't make that out. Could you put it another way, or type it?",
    ]);
  });

  it("without a store, a restart forgets (the old behaviour, now only a fallback)", async () => {
    const lines: QConversationMessage[] = [];
    spoken(lines, "Fidiani inanituma attention");
    await instance(lines, undefined).answer(request());
    spoken(lines, "Fidiani inanituma");
    await instance(lines, undefined).answer(request());
    expect(qLines(lines)).toEqual([
      "Sorry, I didn't catch that. Say it again?",
      "Sorry, I didn't catch that. Say it again?",
    ]);
  });

  it("a failing store leaves the turn on memory and never fails it", async () => {
    const lines: QConversationMessage[] = [];
    const { store } = rowStore({ failing: true });
    const seam = instance(lines, store);
    spoken(lines, "Fidiani inanituma attention");
    expect((await seam.answer(request())).kind).toBe("ANSWERED");
    spoken(lines, "Fidiani inanituma");
    await seam.answer(request());
    expect(qLines(lines)[1]).toBe(
      "I still couldn't make that out. Could you put it another way, or type it?",
    );
  });
});

describe("what is read back", () => {
  it("round-trips the last action, the series and the focus", () => {
    const snapshot = {
      v: 1 as const,
      unclearInARow: 0,
      lastAction: {
        tool: "change_my_mandate",
        arguments: { stages: ["SEED"] },
        utterance: "set my stages to seed",
        outcome: "NOT_DONE" as const,
      },
      sequence: { topic: "my mandate", total: 3, asked: 1 },
      focus: { areas: ["Records"], tools: ["read_my_record"], widen: true },
    };
    expect(readCoreSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({
      unclearInARow: 0,
      lastAction: snapshot.lastAction,
      sequence: snapshot.sequence,
      focus: snapshot.focus,
    });
  });

  it("refuses anything it did not write", () => {
    for (const stored of [
      null,
      "text",
      { v: 2 },
      {
        v: 1,
        unclearInARow: -1,
        lastAction: null,
        sequence: null,
        focus: null,
      },
      {
        v: 1,
        unclearInARow: 0,
        lastAction: {
          tool: "x",
          arguments: null,
          utterance: "u",
          outcome: "DONE",
        },
        sequence: null,
        focus: null,
      },
    ]) {
      expect(readCoreSnapshot(stored)).toBeNull();
    }
  });
});

describe("the snapshot written stays inside the row's bound (live 2026-10-09)", () => {
  // jsonb's text form puts a space after every ":" and ",": the column
  // check measures that, not the JSON the server wrote.
  const jsonbTextLength = (value: unknown) =>
    JSON.stringify(value).replace(/([:,])/g, "$1 ").length;
  const wide = {
    v: 1 as const,
    unclearInARow: 0,
    lastAction: {
      tool: "draft_update",
      arguments: { body: "x".repeat(3_000) },
      utterance: "send the update",
      outcome: "PREPARED" as const,
    },
    sequence: null,
    focus: {
      areas: Array.from({ length: 40 }, (_, i) => `area_${String(i)}`),
      tools: Array.from(
        { length: 200 },
        (_, i) => `tool_${String(i)}_${"t".repeat(60)}`,
      ),
    },
  };

  it("drops the recomputable tool focus first and keeps the last action", () => {
    const bounded = boundedCoreSnapshot(wide);
    expect(bounded.focus).toBeNull();
    expect(bounded.lastAction).toEqual(wide.lastAction);
    expect(jsonbTextLength(bounded)).toBeLessThanOrEqual(16_384);
    expect(readCoreSnapshot(bounded)).not.toBeNull();
  });

  it("drops the last action when it alone is too large, never writing a partial one", () => {
    const bounded = boundedCoreSnapshot({
      ...wide,
      lastAction: {
        ...wide.lastAction,
        arguments: { body: "y".repeat(20_000) },
      },
    });
    expect(bounded.lastAction).toBeNull();
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(
      CORE_SNAPSHOT_MAX_CHARS,
    );
    expect(readCoreSnapshot(bounded)).not.toBeNull();
  });

  it("leaves a snapshot that fits as it is", () => {
    const small = {
      ...wide,
      focus: { areas: ["capital"], tools: ["what_needs_me"] },
    };
    expect(boundedCoreSnapshot(small)).toBe(small);
  });
});
