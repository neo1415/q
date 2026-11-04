import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import type { QRuntimeDependencies } from "../src/application/dependencies.js";
import { createRecordSpokenExchange } from "../src/application/spoken-exchange.js";

/**
 * Owner report 2026-11-04: one spoken reply reached the conversation as
 * one Q message per piece the line reported, each its own row in Chat.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const CONVERSATION = "a0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000001";
const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

function recording() {
  const inserted: { role: string; content: string; runId: string }[] = [];
  const dependencies: QRuntimeDependencies = {
    sql: {} as never,
    transactions: { run: (work) => work({ sql: {} } as never) },
    subjects: {} as never,
    securityEvents: {} as never,
    repositories: {
      runs: {
        findLatestForConversation: () => Promise.resolve({ id: RUN }),
      },
      messages: {
        insert: (
          _tx: unknown,
          row: { role: string; content: string; runId: string },
        ) => {
          inserted.push({
            role: row.role,
            content: row.content,
            runId: row.runId,
          });
          return Promise.resolve({});
        },
      },
    } as never,
  };
  return { inserted, record: createRecordSpokenExchange(dependencies) };
}

describe("a spoken exchange in the conversation", () => {
  it("writes one reply reported in pieces as one Q message, in order", async () => {
    const { inserted, record } = recording();
    // The pieces the live line reported for the owner's reply.
    const pieces = [
      "I don't have a task from",
      "you yet.",
      "What",
      "do you want me",
      "to take on",
      "—",
      "Tensorgate",
      "or one of the",
      "others?",
    ];
    const written = await record({
      actor,
      conversationId: CONVERSATION,
      messages: [
        {
          role: "USER",
          content: "How far with the task that I gave you to do",
        },
        ...pieces.map((content) => ({ role: "Q" as const, content })),
      ],
      correlationId: CorrelationIdSchema.parse(
        "cor_d0000000-0000-4000-8000-000000000001",
      ),
    });
    expect(written).toBe(2);
    expect(inserted).toEqual([
      {
        role: "USER",
        content: "How far with the task that I gave you to do",
        runId: RUN,
      },
      {
        role: "Q",
        content:
          "I don't have a task from you yet. What do you want me to take on — Tensorgate or one of the others?",
        runId: RUN,
      },
    ]);
  });

  it("keeps separate turns separate and drops empty pieces", async () => {
    const { inserted, record } = recording();
    await record({
      actor,
      conversationId: CONVERSATION,
      messages: [
        { role: "Q", content: "Hello." },
        { role: "USER", content: "  " },
        { role: "USER", content: "Hi." },
        { role: "Q", content: "How can I help?" },
      ],
      correlationId: CorrelationIdSchema.parse(
        "cor_d0000000-0000-4000-8000-000000000001",
      ),
    });
    expect(inserted.map((row) => [row.role, row.content])).toEqual([
      ["Q", "Hello."],
      ["USER", "Hi."],
      ["Q", "How can I help?"],
    ]);
  });
});
