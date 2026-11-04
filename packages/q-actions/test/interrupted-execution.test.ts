import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import {
  createQActionService,
  EXECUTION_INTERRUPTED_AFTER_MS,
  type QActionRecord,
  type QActionRepositories,
  type QApprovalRecord,
} from "../src/index.js";

/**
 * Audit 2026-11-04 ACT-03: a process that stops between the execution
 * claim (EXECUTING) and its finalise left the action EXECUTING forever,
 * read as "saving" and answered IN_PROGRESS on every later call. The
 * reconciliation moves it to RECONCILIATION_REQUIRED, never back to a
 * state the gate would execute again: the side effect may have happened.
 */

const NOW = new Date("2026-11-04T12:00:00.000Z");
const TENANT = randomUUID();

function action(overrides: Partial<QActionRecord>): QActionRecord {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    runId: randomUUID(),
    organisationId: randomUUID(),
    proposedByUserId: randomUUID(),
    actionType: "test.confirm_required",
    actionVersion: 1,
    riskClass: "CONFIRM_REQUIRED",
    targets: [],
    payload: {},
    payloadHash: `sha256:${"0".repeat(64)}`,
    summary: "Send it",
    preview: null,
    reason: null,
    status: "EXECUTING",
    idempotencyKey: `q_action:${randomUUID()}:${randomUUID()}`,
    createdAt: "2026-11-04T10:00:00.000Z",
    updatedAt: "2026-11-04T11:00:00.000Z",
    executedAt: null,
    executionResult: null,
    failureCode: null,
    retryPermitted: false,
    executionAttempts: 1,
    version: 3,
    ...overrides,
  } as QActionRecord;
}

function harness(rows: QActionRecord[]) {
  const byId = new Map<string, QActionRecord>(rows.map((row) => [row.id, row]));
  const audits: unknown[] = [];
  const tx = { sql: {} } as unknown as TransactionContext;
  const transactions: TransactionManager = {
    run: (work: (context: TransactionContext) => Promise<unknown>) => work(tx),
  } as unknown as TransactionManager;
  const repositories = {
    actions: {
      listStuckExecuting: (
        _executor: DatabaseExecutor,
        input: { readonly before: Date; readonly limit: number },
      ) =>
        Promise.resolve(
          [...byId.values()]
            .filter(
              (row) =>
                row.status === "EXECUTING" &&
                Date.parse(row.updatedAt) <= input.before.getTime(),
            )
            .map((row) => ({ tenantId: row.tenantId, actionId: row.id })),
        ),
      lockById: (_tx: TransactionContext, _tenant: string, id: string) =>
        Promise.resolve(byId.get(id) ?? null),
      transition: (
        _tx: TransactionContext,
        input: {
          readonly actionId: string;
          readonly expectedVersion: number;
          readonly status: QActionRecord["status"];
          readonly failureCode?: string | null;
          readonly retryPermitted?: boolean;
        },
      ) => {
        const row = byId.get(input.actionId);
        if (row?.version !== input.expectedVersion) {
          return Promise.resolve(null);
        }
        const next = {
          ...row,
          status: input.status,
          failureCode: input.failureCode ?? row.failureCode,
          retryPermitted: input.retryPermitted ?? row.retryPermitted,
          version: row.version + 1,
          updatedAt: NOW.toISOString(),
        } as QActionRecord;
        byId.set(row.id, next);
        return Promise.resolve(next);
      },
    },
    approvals: {
      listForAction: (): Promise<readonly QApprovalRecord[]> =>
        Promise.resolve([]),
    },
  } as unknown as QActionRepositories;
  const audit = {
    record: (_tx: TransactionContext, event: unknown) => {
      audits.push(event);
      return Promise.resolve();
    },
  } as unknown as MaterialActionAuditWriter;
  const service = createQActionService({
    sql: {} as DatabaseExecutor,
    transactions,
    repositories,
    runtime: {} as never,
    registry: {} as never,
    authorization: {} as never,
    audit,
    clock: { now: () => NOW },
  });
  return { service, byId, audits };
}

describe("an action left EXECUTING by a stopped process (ACT-03)", () => {
  it("becomes RECONCILIATION_REQUIRED, never retryable, with an audit entry", async () => {
    const stuck = action({});
    const { service, byId, audits } = harness([stuck]);
    const reconcile = service.reconcileInterrupted;
    if (reconcile === undefined) throw new Error("no reconciliation");
    expect(await reconcile()).toBe(1);
    const after = byId.get(stuck.id);
    expect(after?.status).toBe("RECONCILIATION_REQUIRED");
    expect(after?.failureCode).toBe("EXECUTION_INTERRUPTED");
    expect(after?.retryPermitted).toBe(false);
    expect(audits).toHaveLength(1);
    // A second sweep changes nothing.
    expect(await reconcile()).toBe(0);
    expect(byId.get(stuck.id)?.version).toBe(stuck.version + 1);
  });

  it("leaves a recent execution, and every other status, alone", async () => {
    const live = action({
      updatedAt: new Date(
        NOW.getTime() - EXECUTION_INTERRUPTED_AFTER_MS + 60_000,
      ).toISOString(),
    });
    const approved = action({ status: "APPROVED" });
    const executed = action({ status: "EXECUTED" });
    const { service, byId } = harness([live, approved, executed]);
    expect(await service.reconcileInterrupted?.()).toBe(0);
    expect(byId.get(live.id)?.status).toBe("EXECUTING");
    expect(byId.get(approved.id)?.status).toBe("APPROVED");
    expect(byId.get(executed.id)?.status).toBe("EXECUTED");
  });

  it("cannot be shrunk below its floor to catch a live execution", async () => {
    const twoMinutes = action({
      updatedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
    });
    const { service, byId } = harness([twoMinutes]);
    expect(await service.reconcileInterrupted?.({ olderThanMs: 1 })).toBe(0);
    expect(byId.get(twoMinutes.id)?.status).toBe("EXECUTING");
  });
});
