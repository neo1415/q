import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";
import { withoutSupersededUtterances } from "../src/domain/utterances.js";

/**
 * One spoken utterance is one turn in the stored conversation (founder
 * live test 2026-09-27, failure 9). Identity is the utterance id the voice
 * channel gives, never the words: a later form of the same utterance
 * supersedes an earlier one, and a run that answered the superseded
 * fragment is not part of the conversation as it is read.
 */

type Row = {
  readonly runId: string;
  readonly role: "USER" | "Q";
  readonly content: string;
  readonly utteranceRef?: string;
};

const U1 = "voice:f0000000-0000-4000-8000-000000000001:2.aaaaaaaaaaaaaaaa";
const U2 = "voice:f0000000-0000-4000-8000-000000000001:4.bbbbbbbbbbbbbbbb";

describe("the conversation as it reads with spoken utterances", () => {
  it("keeps the latest form of an utterance, and drops the fragment's run whole", () => {
    const rows: Row[] = [
      { runId: "r0", role: "USER", content: "Find me founders." },
      { runId: "r0", role: "Q", content: "None are discoverable yet." },
      { runId: "r1", role: "USER", content: "Okay.", utteranceRef: U1 },
      // The fragment was answered before the person carried on.
      { runId: "r1", role: "Q", content: "What would you like next?" },
      {
        runId: "r2",
        role: "USER",
        // Re-heard differently: words are not what ties the two together.
        content: "Ok, that that makes sense.",
        utteranceRef: U1,
      },
      { runId: "r2", role: "Q", content: "Good. Shall we look wider?" },
    ];
    expect(
      withoutSupersededUtterances(rows).map((row) => [row.role, row.content]),
    ).toEqual([
      ["USER", "Find me founders."],
      ["Q", "None are discoverable yet."],
      ["USER", "Ok, that that makes sense."],
      ["Q", "Good. Shall we look wider?"],
    ]);
  });

  it("never merges different utterances, even with the same words", () => {
    const rows: Row[] = [
      { runId: "r1", role: "USER", content: "Yes.", utteranceRef: U1 },
      { runId: "r1", role: "Q", content: "Saved." },
      { runId: "r2", role: "USER", content: "Yes.", utteranceRef: U2 },
      { runId: "r2", role: "Q", content: "Done." },
      // Typed turns carry no utterance and are never folded.
      { runId: "r3", role: "USER", content: "Yes." },
      { runId: "r4", role: "USER", content: "Yes." },
    ];
    expect(withoutSupersededUtterances(rows)).toEqual(rows);
  });
});

describe("a spoken run stores the utterance its words belong to", () => {
  const person = ActorContextSchema.parse({
    userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
    membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
    actorType: "HUMAN",
  });

  it("passes the utterance id to the stored message, and nothing when there is none", async () => {
    const stored: unknown[] = [];
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
            Promise.resolve({
              id: randomUUID(),
              status: "RECEIVED",
              ...input,
            }),
          allocateEventSequence: () => Promise.resolve(1),
        },
        messages: {
          insert: (_tx: unknown, input: object) => {
            stored.push(input);
            return Promise.resolve({ id: randomUUID(), ...input });
          },
        },
        runEvents: {
          append: (_tx: unknown, input: unknown) => Promise.resolve(input),
        },
      },
    } as unknown as QRuntimeDependencies);
    const ask = (utteranceRef?: string) =>
      create({
        actor: person,
        input: {
          capability: "ANSWER",
          message: { text: "Okay. That makes sense." },
          modality: "VOICE",
        },
        idempotencyKey: randomUUID(),
        correlationId: "cor_test",
        ...(utteranceRef === undefined ? {} : { utteranceRef }),
      });
    await ask(U1);
    await ask();
    expect(stored[0]).toMatchObject({ role: "USER", utteranceRef: U1 });
    expect(stored[1]).not.toHaveProperty("utteranceRef");
  });
});
