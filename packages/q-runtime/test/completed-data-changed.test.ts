import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Q_CONTRACT_VERSION,
  QRunCompletedEventSchema,
  QRunIdSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  createQOrchestrationRuntime,
  type QRunRef,
  type QRuntimeDependencies,
} from "../src/index.js";

/**
 * Batch 14 (W1, instant writes): a run whose tools committed a write says
 * so on its completed event, so the page reads its data again; a run that
 * only read says nothing new.
 */

const REF: QRunRef = {
  runId: QRunIdSchema.parse(randomUUID()),
  tenantId: TenantIdSchema.parse(randomUUID()),
  actorUserId: UserIdSchema.parse(randomUUID()),
};

function world() {
  let run = {
    id: REF.runId,
    tenantId: REF.tenantId,
    actorUserId: REF.actorUserId,
    status: "SYNTHESIS",
    version: 3,
    completedAt: null as string | null,
    correlationId: "cor_test",
  };
  const payloads: unknown[] = [];
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
          completedAt: input.completedAt ?? new Date().toISOString(),
        };
        return Promise.resolve(run);
      },
    },
    runEvents: {
      appendNext: (_tx: unknown, input: { payload: unknown }) => {
        payloads.push(input.payload);
        return Promise.resolve({ sequence: payloads.length });
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
  return { runtime, payloads };
}

describe("q.run.completed carries dataChanged when a tool wrote (batch 14)", () => {
  it("a run that saved a company: dataChanged true, and the event is the contract's", async () => {
    const w = world();
    await w.runtime.complete(REF, { answered: true, dataChanged: true });
    expect(w.payloads).toHaveLength(1);
    expect(w.payloads[0]).toMatchObject({
      status: "COMPLETED",
      dataChanged: true,
    });
  });

  it("a run that only read: the field is absent", async () => {
    const w = world();
    await w.runtime.complete(REF, { answered: true, dataChanged: false });
    expect(w.payloads[0]).not.toHaveProperty("dataChanged");
  });

  it("the contract: additive, true or absent, never false", () => {
    const base = {
      contractVersion: Q_CONTRACT_VERSION,
      eventId: randomUUID(),
      runId: REF.runId,
      sequence: 4,
      occurredAt: new Date().toISOString(),
      type: "q.run.completed",
      data: { status: "COMPLETED", completedAt: new Date().toISOString() },
    };
    const parse = (data: Record<string, unknown>) =>
      QRunCompletedEventSchema.safeParse({
        ...base,
        data: { ...base.data, ...data },
      }).success;
    expect(parse({})).toBe(true);
    expect(parse({ dataChanged: true })).toBe(true);
    expect(parse({ dataChanged: false })).toBe(false);
  });
});
