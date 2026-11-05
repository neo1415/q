import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  type QResultBlock,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QConversationState,
  QConversationStateRepository,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Q intelligence step 2: every turn reads the conversation's durable state.
 * The state is folded from the stored turns and saved; the reader gets it
 * with the recent turns whole (not 6 at 400 characters); the answer gets
 * the same state. Deterministic doubles; code asserts.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SILO = "d48c26d2-5aca-4788-9033-073b0f9d08ec";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(screenCompanyId?: string): QAnswerRequest {
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
      ...(screenCompanyId === undefined
        ? {}
        : { screen: { route: "COMPANY", companyId: screenCompanyId } }),
    }),
  };
}

const BASE: QTurnReading = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: null,
} as unknown as QTurnReading;

function memoryStore() {
  let stored: QConversationState | null = null;
  const store: QConversationStateRepository = {
    find: () => Promise.resolve(stored),
    save: (_tx, state) => {
      if ((stored?.version ?? 0) !== state.version)
        return Promise.resolve(false);
      stored = { ...state, version: state.version + 1 };
      return Promise.resolve(true);
    },
    latestSummary: () => Promise.resolve(null),
    appendSummary: () => Promise.resolve(1),
  };
  return { store, stored: () => stored };
}

function conversation(references: QTurnReading["references"] = []) {
  const conversationId = randomUUID();
  const lines: QConversationMessage[] = [];
  const at = (offset: number) =>
    new Date(Date.now() - (1_000 - offset) * 1000).toISOString();
  const add = (
    role: "USER" | "Q",
    content: string,
    blocks?: readonly QResultBlock[],
  ) =>
    lines.push({
      id: randomUUID(),
      tenantId: TENANT,
      conversationId,
      runId: randomUUID(),
      role,
      content,
      contentType: "TEXT",
      createdAt: at(lines.length),
      ...(blocks === undefined ? {} : { blocks }),
    } as unknown as QConversationMessage);
  const inputs: Parameters<QTurnReader["read"]>[0][] = [];
  const delegatedWith: QAnswerRequest[] = [];
  const inserted: string[] = [];
  const memory = memoryStore();
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      answer: (asked) => {
        delegatedWith.push(asked);
        add("Q", "An answer.");
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      conversationStates: memory.store,
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([...lines]),
        insert: (_tx: unknown, row: { content: string }) => {
          inserted.push(row.content);
          return Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            conversationId: lines[0]?.conversationId,
            runId: randomUUID(),
            role: "Q",
            content: row.content,
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          });
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns: {
      read: (input) => {
        inputs.push(input);
        return Promise.resolve({
          ...BASE,
          kind: "QUESTION_TO_Q",
          references,
        } as unknown as QTurnReading);
      },
    },
    offeredTools: () => Promise.resolve([]),
  });
  return { add, answer, inputs, delegatedWith, memory, inserted };
}

const longReply = `Silo Credit lends to SMEs in Lagos. ${"It has steady growth and a clear plan. ".repeat(12)}Its CFO is Ngozi Eze.`;

describe("the conversation state, read on every turn", () => {
  it("reaches the reader with the recent turns whole, and the answer with the same state, and is saved", async () => {
    const c = conversation();
    c.add("USER", "Show me SME lenders.");
    c.add("Q", "One stands out.", [
      {
        kind: "ANSWER_CARDS",
        title: "SME lenders",
        cards: [
          {
            name: "Silo Credit",
            subject: { kind: "COMPANY", companyId: SILO },
            measures: [],
          },
        ],
      } as unknown as QResultBlock,
    ]);
    for (let turn = 0; turn < 4; turn += 1) {
      c.add("USER", `Question ${String(turn)} about Silo Credit?`);
      c.add("Q", longReply);
    }
    c.add("USER", "When did she join?");
    await c.answer.answer(request());

    const input = c.inputs.at(-1);
    // Ten earlier messages, all of them, the long ones whole.
    expect(input?.recentTurns.length).toBe(10);
    expect(input?.recentTurns.some((turn) => turn.text === longReply)).toBe(
      true,
    );
    expect(input?.conversationState).toMatch(
      /E1 company "Silo Credit" \(Q's card, said by them, said by Q; #2-#10; L1 place 1 of 1\)/u,
    );
    expect(c.delegatedWith.at(-1)?.conversationState).toBe(
      input?.conversationState,
    );
    expect(c.memory.stored()).toMatchObject({ messagesFolded: 11, version: 1 });
    expect(c.memory.stored()?.ledger.entities[0]).toMatchObject({
      id: SILO,
      name: "Silo Credit",
    });
  });
});

const LEDGERFOLD = "5f0c9a5e-1d1e-4c55-9d2b-3f6c1b7a0a11";

/** Q showed two companies as cards: E1 Silo Credit, E2 Ledgerfold. */
function twoCards(references: QTurnReading["references"]) {
  const c = conversation(references);
  c.add("USER", "Show me SME lenders.");
  c.add("Q", "Two stand out.", [
    {
      kind: "ANSWER_CARDS",
      title: "SME lenders",
      cards: [
        {
          name: "Silo Credit",
          subject: { kind: "COMPANY", companyId: SILO },
          measures: [],
        },
        {
          name: "Ledgerfold",
          subject: { kind: "COMPANY", companyId: LEDGERFOLD },
          measures: [],
        },
      ],
    } as unknown as QResultBlock,
  ]);
  return c;
}

describe("step 3: the reader's references, bound by code against the ledger", () => {
  it("binds one reading and hands the answer the records, in the order said", async () => {
    const c = twoCards([
      { phrase: "those two", entityIds: ["E2", "E1"], confidence: "HIGH" },
    ]);
    c.add("USER", "Compare those two.");
    await c.answer.answer(request());
    const asked = c.delegatedWith.at(-1);
    expect(asked?.references).toContain('"those two" means E2 "Ledgerfold"');
    expect(asked?.references).toContain(`COMPANY id ${SILO}`);
    expect(asked?.referencedCompanyIds).toEqual([LEDGERFOLD, SILO]);
  });

  it("asks one short question naming both when two readings are plausible, and answers nothing else", async () => {
    const c = twoCards([
      { phrase: "it", entityIds: ["E1"], confidence: "MEDIUM" },
      { phrase: "it", entityIds: ["E2"], confidence: "MEDIUM" },
    ]);
    c.add("USER", "What's its runway?");
    await c.answer.answer(request());
    expect(c.delegatedWith).toHaveLength(0);
    expect(c.inserted).toEqual([
      'By "it", do you mean Silo Credit or Ledgerfold?',
    ]);
  });

  it("refuses a ref the ledger does not hold (Context Firewall): says so and asks, never binds it", async () => {
    const c = twoCards([
      { phrase: "her", entityIds: ["E9"], confidence: "HIGH" },
    ]);
    c.add("USER", "Email her the memo.");
    await c.answer.answer(request());
    expect(c.delegatedWith).toHaveLength(0);
    expect(c.inserted).toEqual([
      `I'm not sure who or what you mean by "her". Which one do you mean?`,
    ]);
  });
});
