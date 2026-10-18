import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { HeldRetryInput } from "../src/composition/instructions/engine.js";
import { createHeldRetry } from "../src/composition/workforce/held-retry.js";
import { createInMemoryWorkforceStore } from "../src/composition/workforce/store.js";

/**
 * "Ask Q to try again" (Zino, 2026-10-08): only the person's own held
 * draft, only while it is still the latest message to that person, and
 * only one rewrite per press. Holds the reviewer could not grade are
 * looked at again once, automatically.
 */

const owner = { tenantId: randomUUID(), userId: randomUUID() };
const INSTRUCTION = randomUUID();

async function heldDraft(
  store: ReturnType<typeof createInMemoryWorkforceStore>,
  who: typeof owner = owner,
  source: "INSTRUCTION" | "ERRAND" = "INSTRUCTION",
) {
  const { job, leadRunId } = await store.ensureJob(who, {
    source: { kind: source, id: INSTRUCTION },
    goal: "Reply to founders",
    budgetUsd: 0.5,
    threshold: 80,
    maxRedrafts: 1,
    rubricVersion: "v1",
  });
  const draftId = await store.addDraft(who, {
    jobId: job.id,
    writerRunId: leadRunId,
    attempt: 1,
    parentDraftId: null,
    channel: "CHAT",
    counterpartName: "Spheros",
    body: "Hi Ada, would 20 minutes next week work?",
  });
  if (draftId === null) throw new Error("no draft");
  await store.addOutcome(who, {
    jobId: job.id,
    draftId,
    outcome: "HELD",
    reason: "REVIEW_UNAVAILABLE",
    qActionId: null,
  });
  return { draftId, jobId: job.id };
}

function engineDouble() {
  const calls: HeldRetryInput[] = [];
  return {
    calls,
    engine: {
      retryHeld: (input: HeldRetryInput) => {
        calls.push(input);
        return Promise.resolve({
          outcome: "OFFERED" as const,
          qActionId: randomUUID(),
          body: input.body,
        });
      },
    },
  };
}

describe("held retry", () => {
  it("rewrites the person's own held draft through its instruction, once per press", async () => {
    const store = createInMemoryWorkforceStore();
    const { draftId } = await heldDraft(store);
    const { calls, engine } = engineDouble();
    const retry = createHeldRetry({ store, engine: () => engine });
    const input = {
      draftId,
      relationshipId: null,
      idempotencyKey: "press-00000001",
    };
    const [first, again] = await Promise.all([
      retry.retry(owner, input),
      retry.retry(owner, input),
    ]);
    expect(first).toMatchObject({ outcome: "OFFERED" });
    expect(again).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      instructionId: INSTRUCTION,
      userId: owner.userId,
      counterpartName: "Spheros",
      body: "Hi Ada, would 20 minutes next week work?",
    });
  });

  it("someone else's draft is not found; a non-instruction hold is not supported", async () => {
    const store = createInMemoryWorkforceStore();
    const { draftId } = await heldDraft(store);
    const { calls, engine } = engineDouble();
    const retry = createHeldRetry({ store, engine: () => engine });
    const stranger = { tenantId: owner.tenantId, userId: randomUUID() };
    expect(
      await retry.retry(stranger, {
        draftId,
        relationshipId: null,
        idempotencyKey: "press-00000002",
      }),
    ).toEqual({ outcome: "UNAVAILABLE", reason: "NOT_FOUND" });
    const errand = await heldDraft(store, owner, "ERRAND");
    expect(
      await retry.retry(owner, {
        draftId: errand.draftId,
        relationshipId: null,
        idempotencyKey: "press-00000003",
      }),
    ).toEqual({ outcome: "UNAVAILABLE", reason: "NOT_SUPPORTED" });
    expect(calls).toHaveLength(0);
  });

  it("looks again at holds the reviewer could not grade, on its own", async () => {
    const store = createInMemoryWorkforceStore();
    const { draftId } = await heldDraft(store);
    const { calls, engine } = engineDouble();
    const retry = createHeldRetry({
      store,
      engine: () => engine,
      staleHolds: () => Promise.resolve([{ ...owner, draftId }]),
    });
    expect(await retry.sweepStale()).toBe(1);
    expect(calls[0]).toMatchObject({ draftId, relationshipId: null });
  });
});
