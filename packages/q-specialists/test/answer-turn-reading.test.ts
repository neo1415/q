import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader } from "@capital-q/model-gateway/q";
import type { TurnReaderV3Result as TurnReaderResult } from "@capital-q/q-core";
import type {
  QAnswerOutcome,
  QAnswerRequest,
  QConversationMessage,
  QResearchDirective,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Every general turn to Q is read before it is answered (CQ-QX-005):
 * the conversation core decides from the reading whether the public web
 * may be read, and a failed answer is named once by the subsystem that
 * failed — deterministic doubles, code asserts.
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

function seam(options: {
  readonly said: string;
  readonly reading: TurnReaderResult | null;
  readonly outcomes: readonly QAnswerOutcome[];
  readonly visibility?: {
    noteVisibility: (entry: Record<string, unknown>) => void;
  };
}) {
  const message: QConversationMessage = {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role: "USER",
    content: options.said,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
  };
  const directives: (QResearchDirective | undefined)[] = [];
  const outcomes = [...options.outcomes];
  const turns: QTurnReader = {
    read: () => Promise.resolve(options.reading),
  };
  const stored: QConversationMessage[] = [];
  const events: { type: string; data: unknown }[] = [];
  let delegated = 0;
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    ...(options.visibility === undefined
      ? {}
      : { visibility: options.visibility }),
    delegate: {
      answer: async (req) => {
        delegated += 1;
        directives.push(
          req.research === undefined ? undefined : await req.research,
        );
        return (
          outcomes.shift() ?? {
            kind: "ANSWERED",
            messageId: "m",
            modelPolicyVersion: "p",
            promptBundleVersion: "b",
          }
        );
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve([message]),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) => {
          const row = {
            ...input,
            id: randomUUID(),
            contentType: "TEXT",
            createdAt: new Date().toISOString(),
          } as unknown as QConversationMessage;
          stored.push(row);
          return Promise.resolve(row);
        },
      },
      runs: { allocateEventSequence: () => Promise.resolve(events.length + 1) },
      runEvents: {
        append: (
          _tx: unknown,
          input: { eventType: string; payload: unknown },
        ) => {
          events.push({ type: input.eventType, data: input.payload });
          return Promise.resolve(input);
        },
      },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return {
    answer,
    directives,
    stored,
    events,
    delegated: () => delegated,
  };
}

const COMPANY = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

function toolReading(
  tool: Omit<
    NonNullable<TurnReaderResult["tool"]>,
    "documentType" | "subjectName"
  >,
  confidence: TurnReaderResult["confidence"] = "HIGH",
): TurnReaderResult {
  return {
    kind: "TOOL_REQUEST",
    confidence,
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    // v3's document parameters belong to PREPARE_DOCUMENT only.
    tool: { ...tool, documentType: null, subjectName: null },
  };
}

describe("a request for one of Q's own hands (CQ-QACT-001)", () => {
  it("answers 'take me to discover' with a NAVIGATE intent and no model answer (F8)", async () => {
    const run = seam({
      said: "take me to discover",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "DISCOVER",
        visibility: null,
      }),
      outcomes: [],
    });
    const outcome = await run.answer.answer(request());
    expect(outcome.kind).toBe("ANSWERED");
    expect(run.delegated()).toBe(0);
    expect(run.stored).toHaveLength(1);
    expect(run.stored[0]?.content).toBe("Taking you to Discover.");
    expect(run.stored[0]?.blocks).toEqual([
      {
        kind: "UI_INTENT",
        intent: { kind: "NAVIGATE", destination: "DISCOVER" },
      },
    ]);
    expect(run.events.map((event) => event.type)).toEqual([
      "q.message.completed",
    ]);
  });

  it("never navigates on a guess, and never to a surface the run has no subject for", async () => {
    const guess = seam({
      said: "discover?",
      reading: toolReading(
        { kind: "NAVIGATE", destination: "DISCOVER", visibility: null },
        "LOW",
      ),
      outcomes: [],
    });
    await guess.answer.answer(request());
    expect(guess.stored).toHaveLength(0);
    expect(guess.delegated()).toBe(1);

    // No company in this run: its visibility page is not somewhere to go.
    const noCompany = seam({
      said: "open my visibility settings",
      reading: toolReading({
        kind: "NAVIGATE",
        destination: "COMPANY_VISIBILITY",
        visibility: null,
      }),
      outcomes: [],
    });
    await noCompany.answer.answer(request());
    expect(noCompany.stored).toHaveLength(0);
    expect(noCompany.delegated()).toBe(1);
  });

  it("hands 'make my company visible to investors' to the proposer and prepares no document (F6)", async () => {
    const noted: Record<string, unknown>[] = [];
    const run = seam({
      said: "please make my company visible to investors",
      reading: toolReading({
        kind: "SET_VISIBILITY",
        destination: null,
        visibility: "network_visible",
      }),
      outcomes: [],
      visibility: { noteVisibility: (entry) => noted.push(entry) },
    });
    const turn = {
      ...request(),
      subjects: [{ kind: "COMPANY" as const, companyId: COMPANY }],
    } as QAnswerRequest;
    const outcome = await run.answer.answer(turn);
    expect(outcome.kind).toBe("ANSWERED");
    // Neither the specialist nor the conversational seam ran: nothing
    // that could prepare a deck was reached.
    expect(run.delegated()).toBe(0);
    expect(noted).toEqual([
      {
        runId: turn.runId,
        tenantId: TENANT,
        companyId: COMPANY,
        visibility: "network_visible",
      },
    ]);
    // It explains, honestly, and claims nothing: the action port says it
    // prepared something only once the proposal exists.
    expect(run.stored[0]?.content).toMatch(/recommendations/);
    expect(run.stored[0]?.content).not.toMatch(/prepared|approve|done/i);
  });
});

const advice: TurnReaderResult = {
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "ADVICE", text: "what else should I look for?", about: [] },
  aboutNamedOther: false,
  tool: null,
};

describe("a general turn is read before it is answered", () => {
  it("keeps the web out of an advice question, whatever its words", async () => {
    const { answer, directives } = seam({
      said: "What else should I look for? Check the web if you like.",
      reading: advice,
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives).toEqual([
      { mode: "NEVER", announceSourceChange: false },
    ]);
  });

  it("lets a request for a real example reach the web", async () => {
    const { answer, directives } = seam({
      said: "Give me a real investor like me",
      reading: {
        ...advice,
        question: {
          kind: "REAL_WORLD_EXAMPLE",
          text: "a real investor",
          about: [],
        },
      },
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives[0]?.mode).toBe("EXPLICIT");
  });

  it("treats a turn it could not read as not asking for research", async () => {
    const { answer, directives } = seam({
      said: "Any news on Acme?",
      reading: null,
      outcomes: [],
    });
    await answer.answer(request());
    expect(directives[0]?.mode).toBe("NEVER");
  });
});

describe("a failed answer is named once, by its subsystem", () => {
  it("gives the orchestrator a notice for the first and the stopping failure, read once each", async () => {
    const failed: QAnswerOutcome = {
      kind: "FAILED",
      diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE",
    };
    const { answer } = seam({
      said: "What do you think?",
      reading: advice,
      outcomes: [failed, failed, failed],
    });
    const notices: (string | undefined)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const turn = request();
      await answer.answer(turn);
      notices.push(answer.failureNotice?.(turn.runId));
      // Read once: the port forgets it.
      expect(answer.failureNotice?.(turn.runId)).toBeUndefined();
    }
    expect(notices[0]).toMatch(/reasoning service/i);
    expect(notices[1]).toMatch(/stop trying/i);
    expect(notices[2]).toBeUndefined();
  });

  it("does not notify for a cancellation", async () => {
    const { answer } = seam({
      said: "never mind",
      reading: advice,
      outcomes: [{ kind: "FAILED", diagnosticCode: "RUN_CANCELLED" }],
    });
    const turn = request();
    await answer.answer(turn);
    expect(answer.failureNotice?.(turn.runId)).toBeUndefined();
  });
});
