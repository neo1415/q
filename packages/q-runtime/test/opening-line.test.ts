import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";
import { hashCreateQRunRequest } from "../src/domain/idempotency.js";

/**
 * Founder live 2026-10-01: Home said "There are companies in your feed,
 * ranked against your mandate", they asked "what are these companies, can
 * you list them?", and Q answered it was not sure which companies they
 * meant. The welcome was drawn by the page and never part of the
 * conversation Q reads. A surface's opening words now start the
 * conversation as Q's first line.
 */
const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function harness() {
  const stored: { role: string; content: string }[] = [];
  const create = createCreateQRun({
    sql: {} as never,
    transactions: {
      run: (work: (tx: unknown) => unknown) => work({ sql: {} }),
    },
    subjects: { supports: () => true, resolve: () => Promise.resolve(null) },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({ id: randomUUID(), ...input }),
        setSubjects: () => Promise.resolve(),
      },
      runs: {
        insert: (_tx: unknown, input: object) =>
          Promise.resolve({ id: randomUUID(), status: "RECEIVED", ...input }),
        allocateEventSequence: () => Promise.resolve(1),
      },
      messages: {
        insert: (_tx: unknown, input: { role: string; content: string }) => {
          stored.push(input);
          return Promise.resolve({ id: randomUUID(), ...input });
        },
      },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    },
  } as unknown as QRuntimeDependencies);
  return { create, stored };
}

const OPENING =
  "Welcome back, Ngozi. There are companies in your feed, ranked against your mandate. Where would you like to start?";

describe("a surface's opening words start the conversation", () => {
  it("records them as Q's first line, before the question", async () => {
    const { create, stored } = harness();
    const result = await create({
      actor: person,
      input: {
        capability: "ANSWER",
        message: { text: "what are these companies, can you list them" },
        modality: "TEXT",
        opening: OPENING,
      },
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
    });
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ["Q", OPENING],
      ["USER", "what are these companies, can you list them"],
    ]);
    // The run's own message is still the person's question.
    expect(result.message).toMatchObject({ role: "USER" });
  });

  it("is the same question under the same key without them (a reload)", () => {
    const asked = {
      capability: "ANSWER" as const,
      message: { text: "list them" },
      modality: "TEXT" as const,
    };
    expect(
      hashCreateQRunRequest({
        ...asked,
        opening: OPENING,
        screen: { route: "HOME" },
      } as never),
    ).toBe(hashCreateQRunRequest(asked));
    expect(
      hashCreateQRunRequest({ ...asked, message: { text: "other" } }),
    ).not.toBe(hashCreateQRunRequest(asked));
  });
});
