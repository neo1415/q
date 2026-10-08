import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import { speculationGate, type QTurnReader } from "@capital-q/model-gateway/q";
import type { TurnReaderV8Result } from "@capital-q/q-core";
import type {
  QAnswerOutcome,
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";
import type { QSpeculationEvent } from "../src/speculation.js";

/**
 * Voice speculation (latency2): a spoken question's answer starts beside
 * the turn reader and is adopted only where the turn's own path arrives at
 * the same answer. The delegate here holds its output exactly as the
 * answer seam does (the model gateway's speculation gate), so what is
 * asserted is what a person would hear and what would be stored.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(subjects: QAnswerRequest["subjects"] = []): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects,
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

const QUESTION: TurnReaderV8Result = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: {
    kind: "ABOUT_CAPITAL_Q",
    text: "What can you do for me?",
    about: [],
  },
  aboutNamedOther: false,
  tool: null,
};

const NAVIGATE: TurnReaderV8Result = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
  tool: {
    kind: "NAVIGATE",
    destination: "DISCOVER",
    visibility: null,
    documentType: null,
    subjectName: null,
    unknownScreen: null,
  },
};

const RESEARCH: TurnReaderV8Result = {
  kind: "RESEARCH_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: {
    kind: "PUBLIC_FACTS",
    text: "What did Paystack raise last?",
    about: [],
  },
  aboutNamedOther: true,
  tool: null,
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function seam(options: {
  readonly said: string;
  readonly reading: TurnReaderV8Result | null;
  readonly spoken?: boolean;
  readonly speculate?: boolean;
  /** How long the turn reader takes. */
  readonly readerMs?: number;
  /** How long the answer takes to its first sentence. */
  readonly firstSentenceMs?: number;
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
    ...(options.spoken === false ? {} : { utteranceRef: "utt-1" }),
  };
  const calls: QAnswerRequest[] = [];
  const heard: { readonly at: number; readonly text: string }[] = [];
  const stored: string[] = [];
  const events: QSpeculationEvent[] = [];
  const turns: QTurnReader = {
    read: async () => {
      await sleep(options.readerMs ?? 0);
      return options.reading;
    },
  };
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => true,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      // Holds what it says and stores exactly as the answer seam does.
      answer: async (req): Promise<QAnswerOutcome> => {
        calls.push(req);
        const gate = speculationGate(req.speculation);
        await sleep(options.firstSentenceMs ?? 0);
        const text = `Answer ${String(calls.length)}.`;
        const say = () => {
          heard.push({ at: Date.now(), text });
        };
        if (gate === null) say();
        else gate.emit(say);
        if (gate !== null) await gate.ready();
        stored.push(text);
        return {
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "p",
          promptBundleVersion: "b",
        };
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
    ...(options.speculate === false
      ? {}
      : {
          speculation: {
            spoken: true,
            observe: (event: QSpeculationEvent) => {
              events.push(event);
            },
          },
        }),
  });
  return { answer, calls, heard, stored, events };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a spoken question answered speculatively (latency2)", () => {
  it("adopts the speculation when the reading is a plain question: one answer, said once", async () => {
    const run = seam({ said: "What can you do for me?", reading: QUESTION });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]?.speculation).toBeDefined();
    expect(run.events).toMatchObject([{ outcome: "ADOPTED", reason: null }]);
    expect(run.heard.map((h) => h.text)).toEqual(["Answer 1."]);
    expect(run.stored).toEqual(["Answer 1."]);
  });

  it("cancels it for a navigation: the move is made and nothing of the speculation is said or stored", async () => {
    const run = seam({
      said: "Let's have a look at Discover",
      reading: NAVIGATE,
    });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]?.signal?.aborted).toBe(true);
    expect(run.events).toMatchObject([
      { outcome: "CANCELLED", reason: "KIND" },
    ]);
    expect(run.heard).toEqual([]);
    expect(run.stored).toHaveLength(1);
    expect(run.stored[0]).toMatch(
      /^(?:Here's Discover|Discover is up|Over to Discover)\.$/u,
    );
  });

  it("cancels it for a research request and answers on the normal path, said once", async () => {
    const run = seam({
      said: "What did Paystack raise last?",
      reading: RESEARCH,
    });
    await run.answer.answer(request());
    expect(run.events).toMatchObject([
      { outcome: "CANCELLED", reason: "KIND" },
    ]);
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1]?.speculation).toBeUndefined();
    expect((await run.calls[1]?.research)?.mode).not.toBe("NEVER");
    expect(run.heard.map((h) => h.text)).toEqual(["Answer 2."]);
    expect(run.stored).toEqual(["Answer 2."]);
  });

  it("cancels it when the turn could not be read, and the normal path answers", async () => {
    const run = seam({ said: "What can you do?", reading: null });
    await run.answer.answer(request());
    expect(run.events).toMatchObject([
      { outcome: "CANCELLED", reason: "UNREAD" },
    ]);
    expect(run.calls[1]?.turnUnread).toBe(true);
    expect(run.heard.map((h) => h.text)).toEqual(["Answer 2."]);
  });

  it("never speculates a typed turn, a turn about a company, or a web address", async () => {
    for (const run of [
      seam({ said: "What can you do?", reading: QUESTION, spoken: false }),
      seam({ said: "Have a look at acme.io", reading: QUESTION }),
    ]) {
      await run.answer.answer(request());
      expect(run.events).toEqual([]);
      expect(run.calls.every((c) => c.speculation === undefined)).toBe(true);
    }
    const company = seam({ said: "How is it doing?", reading: QUESTION });
    await company.answer
      .answer(request([{ kind: "COMPANY", companyId: COMPANY }]))
      .catch(() => undefined);
    expect(company.events).toEqual([]);
  });

  it("answers under the run's own firewall plan, never one of its own", async () => {
    const run = seam({ said: "What can you do for me?", reading: QUESTION });
    const asked = request();
    await run.answer.answer(asked);
    expect(run.calls[0]?.plan).toBe(asked.plan);
    expect(run.calls[0]?.actor).toBe(asked.actor);
  });
});

describe("time to Q's first spoken words with speculation (fakes, latency2)", () => {
  async function firstHeardAt(options: {
    readonly readerMs: number;
    readonly firstSentenceMs: number;
    readonly speculate: boolean;
  }): Promise<number> {
    vi.useFakeTimers();
    const run = seam({
      said: "What can you do for me?",
      reading: QUESTION,
      ...options,
    });
    const started = Date.now();
    const answering = run.answer.answer(request());
    await vi.advanceTimersByTimeAsync(10_000);
    await answering;
    const first = run.heard[0];
    if (first === undefined) throw new Error("nothing was said");
    return first.at - started;
  }

  it("a reader slower than the first sentence: first words when the reading lands, not reading + sentence", async () => {
    const before = await firstHeardAt({
      readerMs: 1_500,
      firstSentenceMs: 800,
      speculate: false,
    });
    const after = await firstHeardAt({
      readerMs: 1_500,
      firstSentenceMs: 800,
      speculate: true,
    });
    expect(before).toBe(2_300);
    expect(after).toBe(1_500);
  });

  it("a reader faster than the first sentence: first words at the first sentence", async () => {
    const after = await firstHeardAt({
      readerMs: 300,
      firstSentenceMs: 800,
      speculate: true,
    });
    expect(after).toBe(800);
  });
});
