import { randomUUID } from "node:crypto";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  createEventRegistry,
  defineEvent,
  EventIdSchema,
  WORKERS_WAKE_CHANNEL,
  type CapitalQEvent,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";

import { createOutboxWriter } from "../src/index.js";

/**
 * Supabase egress restriction (24 Oct 2026): idle worker loops back off,
 * and a new outbox event wakes them on commit so an upload stays prompt.
 */

const Fixture = defineEvent({
  name: "test.fixture.woken",
  version: 1,
  owner: "test",
  producer: "capitalq://workers/test/fixture",
  consumers: ["test"],
  sensitivity: "INTERNAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z.object({ fixtureId: z.uuid() }),
  description: "Test fixture.",
});

const writer = createOutboxWriter({ registry: createEventRegistry([Fixture]) });

function event(): CapitalQEvent<unknown> {
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: Fixture.name,
    source: Fixture.producer,
    time: new Date().toISOString(),
    dataContentType: "application/json",
    eventVersion: 1,
    data: { fixtureId: randomUUID() },
  };
}

/** Records each statement; the insert returns `inserted` rows. */
function recordingTx(inserted: unknown[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });
    if (text.includes("insert into events.outbox")) {
      return Promise.resolve(inserted);
    }
    if (text.includes("select (o.payload")) {
      return Promise.resolve([{ same: true }]);
    }
    return Promise.resolve([]);
  };
  return { tx: { sql } as unknown as TransactionContext, statements };
}

const wakes = (statements: { text: string; values: unknown[] }[]) =>
  statements.filter((s) => s.text.includes("pg_notify"));

describe("a new outbox event", () => {
  it("wakes the workers in the same transaction", async () => {
    const { tx, statements } = recordingTx([{ id: 1 }]);
    await expect(writer.enqueue(tx, event())).resolves.toEqual({
      status: "ENQUEUED",
    });
    expect(wakes(statements)).toEqual([
      expect.objectContaining({ values: [WORKERS_WAKE_CHANNEL] }),
    ]);
  });

  it("does not wake them for an event already recorded", async () => {
    const { tx, statements } = recordingTx([]);
    await expect(writer.enqueue(tx, event())).resolves.toEqual({
      status: "ALREADY_ENQUEUED",
    });
    expect(wakes(statements)).toEqual([]);
  });
});
