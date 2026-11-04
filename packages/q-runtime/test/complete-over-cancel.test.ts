import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QRunIdSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  createQOrchestrationRuntime,
  type QRunRef,
  type QRuntimeDependencies,
} from "../src/index.js";

/**
 * Acceptance 2026-11-04 J5 (run 88b2236d): Stop reached the run three
 * seconds in, the engine went on to write and deliver the whole answer,
 * and the run was then recorded CANCELLED -- the answer on screen sat
 * under "Couldn't finish… This request was cancelled." An answer already
 * stored completes the run; every other end still honours the request.
 */

const REF: QRunRef = {
  runId: QRunIdSchema.parse(randomUUID()),
  tenantId: TenantIdSchema.parse(randomUUID()),
  actorUserId: UserIdSchema.parse(randomUUID()),
};

function world(status: string, withChain: boolean) {
  let run = {
    id: REF.runId,
    tenantId: REF.tenantId,
    actorUserId: REF.actorUserId,
    status,
    version: 3,
    completedAt: null as string | null,
    correlationId: "cor_test",
  };
  const events: string[] = [];
  const chains: { allowedFrom: readonly string[] }[] = [];
  const repositories = {
    runs: {
      lockForActor: () => Promise.resolve(run),
      transition: (
        _tx: unknown,
        input: { status: string; completedAt?: string },
      ) => {
        run = {
          ...run,
          status: input.status,
          version: run.version + 1,
          completedAt: input.completedAt ?? null,
        };
        return Promise.resolve(run);
      },
      ...(withChain
        ? {
            // The store's single statement: moves only from an allowed state.
            moveChain: (
              _sql: unknown,
              input: { allowedFrom: readonly string[]; status: string },
            ) => {
              chains.push({ allowedFrom: input.allowedFrom });
              if (!input.allowedFrom.includes(run.status)) {
                return Promise.resolve(null);
              }
              run = { ...run, status: input.status, version: run.version + 1 };
              return Promise.resolve(run);
            },
          }
        : {}),
    },
    runEvents: {
      appendNext: (_tx: unknown, input: { eventType: string }) => {
        events.push(input.eventType);
        return Promise.resolve({ sequence: events.length });
      },
      latestVisibleStage: () => Promise.resolve(null),
    },
  };
  const runtime = createQOrchestrationRuntime({
    sql: {} as DatabaseExecutor,
    transactions: {
      run: <T>(work: (tx: { sql: unknown }) => Promise<T>) => work({ sql: {} }),
    },
    subjects: {},
    repositories,
  } as unknown as QRuntimeDependencies);
  return { runtime, events, chains, status: () => run.status };
}

describe("a Stop that arrives while the answer is written (J5)", () => {
  it.each([false, true])(
    "an answered run completes over a pending cancellation (fast path: %s)",
    async (withChain) => {
      const w = world("CANCEL_REQUESTED", withChain);
      const outcome = await w.runtime.complete(REF, { answered: true });
      expect(outcome.kind).toBe("ADVANCED");
      expect(w.status()).toBe("COMPLETED");
      if (!withChain) expect(w.events).toEqual(["q.run.completed"]);
      if (withChain) {
        expect(w.chains[0]?.allowedFrom).toContain("CANCEL_REQUESTED");
      }
    },
  );

  it.each([false, true])(
    "an end that is not an answer still leaves the cancellation in force (fast path: %s)",
    async (withChain) => {
      const w = world("CANCEL_REQUESTED", withChain);
      const outcome = await w.runtime.complete(REF);
      expect(outcome.kind).toBe("CANCEL_REQUESTED");
      expect(w.status()).toBe("CANCEL_REQUESTED");
      const failed = await w.runtime.fail(REF, "INTERNAL_ERROR");
      expect(failed.kind).toBe("CANCEL_REQUESTED");
      expect(w.events).toEqual([]);
    },
  );

  it("a run already cancelled is never reopened by a late answer", async () => {
    const w = world("CANCELLED", false);
    const outcome = await w.runtime.complete(REF, { answered: true });
    expect(outcome.kind).toBe("TERMINAL");
    expect(w.status()).toBe("CANCELLED");
  });
});
