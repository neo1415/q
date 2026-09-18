import { describe, expect, it } from "vitest";

import type { ModelGateway } from "@capital-q/model-gateway";
import type {
  MemoryBundle,
  MemoryService,
  RememberCommand,
} from "@capital-q/q-knowledge";
import type {
  QConversation,
  QConversationMessage,
  QOrchestrator,
  QRunRecord,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createMemoryLearner,
  withLearning,
} from "../src/composition/memory-learner.js";

/**
 * Q learning after a run (ADR 0012): the extractor's proposals go through
 * the memory service with the person's own turns for quote verification,
 * the conversation's title and summary are written back, and all of it
 * hangs off the orchestrator without delaying the handle a caller gets.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000001";
const CONVERSATION = "f0000000-0000-4000-8000-000000000002";
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logger,
} as never;

function world(extractorOutput: unknown) {
  const remembered: RememberCommand[] = [];
  const digests: unknown[] = [];
  const conversation = {
    id: CONVERSATION,
    tenantId: TENANT,
    userId: USER,
    organisationId: null,
    contextType: "PERSONAL",
    subjects: [],
    title: null,
    summary: "Earlier they asked about runway.",
    summaryThrough: "2026-09-17T09:00:00.000Z",
    lastMessageAt: "2026-09-17T10:00:00.000Z",
    createdAt: "2026-09-17T08:00:00.000Z",
    archivedAt: null,
  } as unknown as QConversation;
  const run = {
    id: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    conversationId: CONVERSATION,
    subjects: [],
    status: "COMPLETED",
  } as unknown as QRunRecord;
  const messages = [
    {
      id: "m1",
      runId: RUN,
      conversationId: CONVERSATION,
      role: "USER",
      content: "Actually, call me Dan.",
      createdAt: "2026-09-17T10:00:00.000Z",
    },
    {
      id: "m2",
      runId: RUN,
      conversationId: CONVERSATION,
      role: "Q",
      content: "Dan it is.",
      createdAt: "2026-09-17T10:00:01.000Z",
    },
  ] as unknown as QConversationMessage[];
  const empty: MemoryBundle = {
    person: [],
    company: [],
    thisConversation: null,
    otherConversations: [],
  };
  const memory: MemoryService = {
    recall: () => Promise.resolve(empty),
    remember: (command) => {
      remembered.push(command);
      return Promise.resolve({
        outcome: "REMEMBERED",
        reason: "RECORDED",
        item: {} as never,
      });
    },
    forget: () => Promise.resolve(null),
  };
  const gateway = {
    execute: () =>
      Promise.resolve({
        output: { kind: "STRUCTURED", value: extractorOutput },
      }),
  } as unknown as ModelGateway;
  const learner = createMemoryLearner({
    gateway,
    memory,
    repositories: {
      runs: { findForActor: () => Promise.resolve(run) },
      conversations: {
        findForOwner: () => Promise.resolve(conversation),
        setDigest: (
          _tx: unknown,
          _t: unknown,
          _id: unknown,
          digest: unknown,
        ) => {
          digests.push(digest);
          return Promise.resolve();
        },
        listForOwner: () => Promise.resolve([]),
      },
      messages: {
        listRecentForConversation: () => Promise.resolve(messages),
      },
    } as never,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    people: { displayNameFor: () => Promise.resolve("Daniel") },
    logger,
  });
  return { learner, remembered, digests };
}

describe("the memory learner", () => {
  it("hands each proposal to the gate with the person's turns, and writes the digest back", async () => {
    const { learner, remembered, digests } = world({
      title: "Name change",
      summary: "They asked to be called Dan.",
      items: [
        {
          type: "PREFERENCE",
          key: "preference.address_as",
          content: "Address them as Dan.",
          quote: "call me Dan",
        },
      ],
    });
    await learner.learn({ actor, runId: RUN });
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({
      actor,
      writeMode: "Q_PROPOSED",
      userTurns: ["Actually, call me Dan."],
      candidate: {
        memoryType: "preference",
        memoryKey: "preference.address_as",
      },
      source: { conversationId: CONVERSATION, runId: RUN },
    });
    expect(digests).toEqual([
      {
        title: "Name change",
        summary: "They asked to be called Dan.",
        summaryThrough: "2026-09-17T10:00:01.000Z",
      },
    ]);
  });

  it("writes nothing when the extractor's shape is refused, and never throws", async () => {
    const { learner, remembered, digests } = world({ nonsense: true });
    await expect(learner.learn({ actor, runId: RUN })).resolves.toBeUndefined();
    expect(remembered).toHaveLength(0);
    expect(digests).toHaveLength(0);
  });

  it("hangs off the orchestrator after start and resume, without delaying the handle", async () => {
    const learned: string[] = [];
    const handle = { runId: RUN, status: "COMPLETED", createdAt: "x" };
    const inner = {
      start: () => Promise.resolve(handle),
      resume: () => Promise.resolve(handle),
      cancel: () => Promise.resolve(handle),
    } as unknown as QOrchestrator;
    const wrapped = withLearning(inner, {
      learn: ({ runId }) => {
        learned.push(runId);
        return Promise.resolve();
      },
    });
    const input = { actor, runId: RUN, correlationId: "cor_x" } as never;
    expect(await wrapped.start(input)).toBe(handle);
    expect(await wrapped.resume(input)).toBe(handle);
    await wrapped.cancel(input);
    expect(learned).toEqual([RUN, RUN]);
  });
});
